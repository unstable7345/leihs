import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { createAccounts } from '../src/accounts.js';

const CLAIMS = { name: 'Ana María Puig Soler' };

let api;
let requests;
let users;
let responses;
let accounts;

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

before(async () => {
  api = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://api');
    const body = await readBody(req);
    requests.push({ method: req.method, path: url.pathname, headers: req.headers, body: body && JSON.parse(body) });
    const forced = responses[req.method];
    if (forced) {
      reply(res, forced);
    } else if (req.method === 'GET') {
      // Like leihs: case insensitive, and secondary emails match too.
      const term = url.searchParams.get('term').toLowerCase();
      reply(res, 200, { users: users.filter((u) => u.email.toLowerCase() === term || u.secondary_email === term) });
    } else if (req.method === 'POST') {
      const user = { id: 'new-id', ...JSON.parse(body) };
      users.push(user);
      reply(res, 201, user);
    } else {
      reply(res, 204);
    }
  });
  await new Promise((resolve) => { api.listen(0, '127.0.0.1', resolve); });
  accounts = createAccounts({
    apiUrl: `http://127.0.0.1:${api.address().port}`,
    apiToken: 'secret-token',
    emailDomains: ['enti.cat'],
  });
});

after(() => {
  api.close();
  api.closeAllConnections();
});

beforeEach(() => {
  requests = [];
  users = [];
  responses = {};
});

const linkPath = (userId) => `/admin/system/authentication-systems/microsoft/users/${userId}`;

test('creates a missing account without password sign-in and links it', async () => {
  assert.equal(await accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft'), true);

  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), [
    'GET /admin/users/',
    'POST /admin/users/',
    `PUT ${linkPath('new-id')}`,
  ]);
  assert.deepEqual(requests[1].body, {
    email: 'ana@enti.cat',
    firstname: 'Ana',
    lastname: 'María Puig Soler',
    password_sign_in_enabled: false,
  });
  assert.equal(requests[1].headers.authorization, 'Token secret-token');
  assert.equal(requests[1].headers.accept, 'application/json');
});

test('prefers the separate name claims when Microsoft sends them', async () => {
  await accounts.ensure('ana@enti.cat', { name: 'x y', given_name: 'Ana María', family_name: 'Puig' }, 'microsoft');
  assert.equal(requests[1].body.firstname, 'Ana María');
  assert.equal(requests[1].body.lastname, 'Puig');
});

test('links an existing account without creating or changing it', async () => {
  users.push({ id: 'existing', email: 'Ana@enti.cat' });
  await accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft');
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), [
    'GET /admin/users/',
    `PUT ${linkPath('existing')}`,
  ]);
});

test('an account that only has the address as secondary email is someone else', async () => {
  users.push({ id: 'other', email: 'other@enti.cat', secondary_email: 'ana@enti.cat' });
  await accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft');
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[2].path, linkPath('new-id'));
});

test('does nothing for an address outside the allowed domains', async () => {
  assert.equal(await accounts.ensure('someone@gmail.com', CLAIMS, 'microsoft'), false);
  assert.equal(await accounts.ensure('someone@enti.cat.evil.com', CLAIMS, 'microsoft'), false);
  assert.deepEqual(requests, []);
});

test('uses the account a simultaneous sign-in has just created', async () => {
  // The first search finds nothing, the creation collides, the second search finds it.
  let searches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'GET' && ++searches === 2) users.push({ id: 'race', email: 'ana@enti.cat' });
    if (options.method === 'POST') responses.POST = 409;
    return original(url, options);
  };
  try {
    await accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(requests.at(-1).path, linkPath('race'));
});

test('reports API failures', async () => {
  responses.GET = 401;
  await assert.rejects(accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft'), /search failed with status 401/);

  responses = { POST: 403 };
  await assert.rejects(accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft'), /creation failed with status 403/);

  users.push({ id: 'existing', email: 'ana@enti.cat' });
  responses = { PUT: 403 };
  await assert.rejects(accounts.ensure('ana@enti.cat', CLAIMS, 'microsoft'), /link failed with status 403/);
});
