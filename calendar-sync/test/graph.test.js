import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { createGraph, GraphError } from '../src/graph.js';

let server;
let url;
let requests;
let calendars;
let tokens;
let forced;

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = decodeURIComponent(req.url);
    if (req.url === '/token') {
      tokens += 1;
      return reply(res, 200, { access_token: `token-${tokens}`, expires_in: 3599 });
    }
    requests.push({ method: req.method, path, auth: req.headers.authorization, body: body && JSON.parse(body) });
    if (forced) return reply(res, ...forced);
    if (req.method === 'GET' && path.includes('/calendars?')) {
      const name = /name eq '(.*)'&/.exec(path)[1].replaceAll("''", "'");
      return reply(res, 200, { value: calendars.filter((c) => c.name === name) });
    }
    if (req.method === 'POST' && path.endsWith('/calendars')) {
      const calendar = { id: 'cal-new', ...JSON.parse(body) };
      calendars.push(calendar);
      return reply(res, 201, calendar);
    }
    if (req.method === 'POST') return reply(res, 201, { id: 'event-1' });
    if (req.method === 'PATCH') return reply(res, 200, { id: 'event-1' });
    if (req.method === 'DELETE') return reply(res, 204);
    return reply(res, 400, { error: { code: 'Unexpected' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  requests = [];
  calendars = [{ id: 'cal-1', name: 'Reservas leihs' }];
  tokens = 0;
  forced = undefined;
});

const graphWith = (calendarName = 'Reservas leihs') => createGraph({
  tenantId: 't', clientId: 'c', clientSecret: 's', calendarName, graphUrl: url, tokenUrl: `${url}/token`,
});

test('creates events in the named calendar, finding it once and reusing the token', async () => {
  const graph = graphWith();
  assert.equal(await graph.createEvent('so@enti.cat', { subject: 'Buc 3' }), 'event-1');
  await graph.createEvent('so@enti.cat', { subject: 'Buc 4' });
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path.split('?')[0]}`), [
    'GET /users/so@enti.cat/calendars',
    'POST /users/so@enti.cat/calendars/cal-1/events',
    'POST /users/so@enti.cat/calendars/cal-1/events',
  ]);
  assert.equal(tokens, 1);
  assert.equal(requests[1].auth, 'Bearer token-1');
  assert.deepEqual(requests[1].body, { subject: 'Buc 3' });
});

test('creates the calendar when it does not exist, quoting its name', async () => {
  await graphWith("Reservas d'en Quico").createEvent('so@enti.cat', { subject: 'Buc 3' });
  assert.deepEqual(requests[1], { method: 'POST', path: '/users/so@enti.cat/calendars', auth: 'Bearer token-1', body: { name: "Reservas d'en Quico" } });
  assert.equal(requests[2].path, '/users/so@enti.cat/calendars/cal-new/events');
});

test('without a calendar name it uses the main calendar', async () => {
  await graphWith('').createEvent('so@enti.cat', { subject: 'Buc 3' });
  assert.deepEqual(requests.map((r) => r.path), ['/users/so@enti.cat/calendar/events']);
});

test('updates and deletes by event id', async () => {
  const graph = graphWith();
  await graph.updateEvent('so@enti.cat', 'AAMk=', { subject: 'Buc 3' });
  await graph.deleteEvent('so@enti.cat', 'AAMk=');
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ['PATCH /users/so@enti.cat/events/AAMk=', 'DELETE /users/so@enti.cat/events/AAMk=']);
});

test('errors carry status, code and how long to wait', async () => {
  forced = [429, { error: { code: 'ApplicationThrottled', message: 'Too many' } }, { 'Retry-After': '12' }];
  await assert.rejects(graphWith('').createEvent('so@enti.cat', {}), (error) => {
    assert.ok(error instanceof GraphError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'ApplicationThrottled');
    assert.equal(error.retryAfterSeconds, 12);
    return true;
  });
});
