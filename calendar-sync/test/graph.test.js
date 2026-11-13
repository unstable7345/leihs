import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { createGraph, GraphError } from '../src/graph.js';

let server;
let url;
let requests;
let folders; // parent path → [{ id, name }]: calendars of a user or a group, and groups
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
    const path = decodeURIComponent(req.url).split('?')[0];
    if (req.url === '/token') {
      tokens += 1;
      return reply(res, 200, { access_token: `token-${tokens}`, expires_in: 3599 });
    }
    requests.push({ method: req.method, path, auth: req.headers.authorization, body: body && JSON.parse(body) });
    if (forced) return reply(res, ...forced);
    if (/\/(calendars|calendarGroups)$/.test(path)) {
      if (req.method === 'GET') return reply(res, 200, { value: folders[path] ?? [] });
      const folder = { id: `id-${Object.values(folders).flat().length + 1}`, ...JSON.parse(body) };
      (folders[path] ??= []).push(folder);
      return reply(res, 201, folder);
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
  folders = { '/users/so@enti.cat/calendars': [{ id: 'cal-1', name: 'Reservas leihs' }] };
  tokens = 0;
  forced = undefined;
});

const graphWith = (calendarGroup = '') => createGraph({
  tenantId: 't', clientId: 'c', clientSecret: 's', calendarGroup, graphUrl: url, tokenUrl: `${url}/token`,
});
const calls = () => requests.map((r) => `${r.method} ${r.path}`);

test('creates events in the named calendar, finding it once and reusing the token', async () => {
  const graph = graphWith();
  assert.equal(await graph.createEvent('so@enti.cat', 'Reservas leihs', { subject: 'Buc 3' }), 'event-1');
  await graph.createEvent('so@enti.cat', 'Reservas leihs', { subject: 'Buc 4' });
  assert.deepEqual(calls(), [
    'GET /users/so@enti.cat/calendars',
    'POST /users/so@enti.cat/calendars/cal-1/events',
    'POST /users/so@enti.cat/calendars/cal-1/events',
  ]);
  assert.equal(tokens, 1);
  assert.equal(requests[1].auth, 'Bearer token-1');
  assert.deepEqual(requests[1].body, { subject: 'Buc 3' });
});

test('creates the calendar when it does not exist', async () => {
  await graphWith().createEvent('so@enti.cat', "Reservas d'en Quico", { subject: 'Buc 3' });
  assert.deepEqual(requests[1].body, { name: "Reservas d'en Quico" });
  assert.equal(requests[2].path, '/users/so@enti.cat/calendars/id-2/events');
});

test('without a calendar name it uses the main calendar', async () => {
  await graphWith().createEvent('so@enti.cat', '', { subject: 'Buc 3' });
  assert.deepEqual(calls(), ['POST /users/so@enti.cat/calendar/events']);
});

test('with a group, one calendar per space inside it, group and calendars created once', async () => {
  const graph = graphWith('Reservas leihs');
  await graph.createEvent('so@enti.cat', 'Buc 1', { subject: 'Buc 1 — Ana' });
  await graph.createEvent('so@enti.cat', 'Buc 1', { subject: 'Buc 1 — Pol' });
  await graph.createEvent('so@enti.cat', 'Sala de Control', { subject: 'Sala de Control — Ana' });
  const group = folders['/users/so@enti.cat/calendarGroups'];
  assert.deepEqual(group.map((g) => g.name), ['Reservas leihs']);
  const inGroup = folders[`/users/so@enti.cat/calendarGroups/${group[0].id}/calendars`];
  assert.deepEqual(inGroup.map((c) => c.name), ['Buc 1', 'Sala de Control']);
  assert.deepEqual(calls().filter((c) => c.endsWith('/events')), [
    `POST /users/so@enti.cat/calendars/${inGroup[0].id}/events`,
    `POST /users/so@enti.cat/calendars/${inGroup[0].id}/events`,
    `POST /users/so@enti.cat/calendars/${inGroup[1].id}/events`,
  ]);
  assert.equal(calls().filter((c) => c === 'GET /users/so@enti.cat/calendarGroups').length, 1);
});

test('with a group that already exists, it reuses the group and its calendars', async () => {
  folders['/users/so@enti.cat/calendarGroups'] = [{ id: 'g-0', name: 'Otro' }, { id: 'g-1', name: 'Reservas leihs' }];
  folders['/users/so@enti.cat/calendarGroups/g-1/calendars'] = [{ id: 'cal-buc1', name: 'Buc 1' }];
  await graphWith('Reservas leihs').createEvent('so@enti.cat', 'Buc 1', { subject: 'Buc 1 — Ana' });
  assert.deepEqual(calls(), [
    'GET /users/so@enti.cat/calendarGroups',
    'GET /users/so@enti.cat/calendarGroups/g-1/calendars',
    'POST /users/so@enti.cat/calendars/cal-buc1/events',
  ]);
});

test('updates and deletes by event id', async () => {
  const graph = graphWith();
  await graph.updateEvent('so@enti.cat', 'AAMk=', { subject: 'Buc 3' });
  await graph.deleteEvent('so@enti.cat', 'AAMk=');
  assert.deepEqual(calls(), ['PATCH /users/so@enti.cat/events/AAMk=', 'DELETE /users/so@enti.cat/events/AAMk=']);
});

test('errors carry status, code and how long to wait', async () => {
  forced = [429, { error: { code: 'ApplicationThrottled', message: 'Too many' } }, { 'Retry-After': '12' }];
  await assert.rejects(graphWith().createEvent('so@enti.cat', '', {}), (error) => {
    assert.ok(error instanceof GraphError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'ApplicationThrottled');
    assert.equal(error.retryAfterSeconds, 12);
    return true;
  });
});
