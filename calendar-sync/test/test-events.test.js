import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { GraphError } from '../src/graph.js';
import { TEST_SUBJECT, testEventFor, testEvents } from '../src/test-events.js';

const CONFIG = { timeZone: 'Europe/Madrid', dryRun: false, calendarGroup: 'Reservas leihs', calendarName: '' };
const NOW = new Date('2026-11-13T23:30:00Z'); // already the 14th in Madrid

let calendars; // "mailbox calendar" → [{ id, subject }]
let calls;
let logs;
let failure;

const db = {
  async spaces() {
    return [
      { mailbox: 'so@enti.cat', model_name: 'Buc 1' },
      { mailbox: 'so@enti.cat', model_name: 'Auditorio' },
    ];
  },
};

const graph = {
  async listEvents(mailbox, calendar) {
    if (failure) throw failure;
    return calendars[`${mailbox} ${calendar}`] ?? [];
  },
  async createEvent(mailbox, calendar, event) {
    calls.push(['create', calendar, event.subject, event.start.dateTime]);
    return 'id';
  },
  async deleteEvent(mailbox, id) { calls.push(['delete', id]); },
};

const run = (options = {}) => testEvents({
  db, graph, config: { ...CONFIG, ...options.config }, log: (event, details) => logs.push({ event, ...details }), now: NOW, remove: options.remove,
});

beforeEach(() => {
  calendars = {};
  calls = [];
  logs = [];
  failure = undefined;
});

test('a test event is free, invites nobody and says what it is', () => {
  const event = testEventFor('Buc 1', '2026-11-15', 'Europe/Madrid');
  assert.equal(event.subject, `${TEST_SUBJECT} — Buc 1`);
  assert.equal(event.showAs, 'free');
  assert.equal(event.attendees, undefined);
  assert.deepEqual(event.start, { dateTime: '2026-11-15T10:00:00', timeZone: 'Europe/Madrid' });
});

test('creates one event tomorrow in the calendar of every space', async () => {
  assert.equal(await run(), 0);
  assert.deepEqual(calls, [
    ['create', 'Buc 1', 'PRUEBA leihs — Buc 1', '2026-11-15T10:00:00'],
    ['create', 'Auditorio', 'PRUEBA leihs — Auditorio', '2026-11-15T10:00:00'],
  ]);
});

test('does not create a second one where there is one already', async () => {
  calendars['so@enti.cat Buc 1'] = [{ id: 'x', subject: 'PRUEBA leihs — Buc 1' }];
  await run();
  assert.deepEqual(calls.map((c) => c[1]), ['Auditorio']);
  assert.equal(logs[0].event, 'test_event_exists');
});

test('remove deletes only the test events', async () => {
  calendars['so@enti.cat Buc 1'] = [
    { id: 'real', subject: 'Buc 1 — Ana Puig' },
    { id: 'test', subject: 'PRUEBA leihs — Buc 1' },
  ];
  await run({ remove: true });
  assert.deepEqual(calls, [['delete', 'test']]);
});

test('a dry run only says what it would do', async () => {
  await run({ config: { dryRun: true } });
  assert.deepEqual(logs.map((l) => l.event), ['would_create_test_event', 'would_create_test_event']);
  assert.deepEqual(calls, []);
});

test('failures are counted and logged', async () => {
  failure = new GraphError(403, 'ErrorAccessDenied', 'no');
  assert.equal(await run(), 2);
  assert.equal(logs[0].event, 'test_event_failed');
});
