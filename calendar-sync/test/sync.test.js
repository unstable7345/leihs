import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { itemFor } from '../src/events.js';
import { GraphError } from '../src/graph.js';
import { localNow, syncOnce } from '../src/sync.js';
import { RESERVATION } from './fixtures.js';

const CONFIG = { timeZone: 'Europe/Madrid', statuses: ['approved', 'signed', 'closed'], dryRun: false, calendarName: 'Reservas leihs' };
const NOW = new Date('2026-11-12T08:00:00Z'); // 09:00 in Madrid

let reservations;
let rows;
let calls;
let failures;
let logs;
let spaces;
let ensured;

const db = {
  async desired(statuses, today) {
    calls.push(['desired', statuses, today]);
    return reservations;
  },
  async spaces() { return spaces; },
  async synced() { return [...rows.values()]; },
  async save(item, eventId) {
    rows.set(item.reservationId, { reservationId: item.reservationId, mailbox: item.mailbox, eventId, fingerprint: item.fingerprint, endsAt: item.endsAt, calendar: item.calendar });
  },
  async remove(row) { rows.delete(row.reservationId); },
};

function call(name, ...args) {
  calls.push([name, ...args]);
  const failure = failures[name];
  if (failure) throw failure;
}

const graph = {
  // Kept apart from calls: the calendars are prepared on every round.
  async ensureCalendar(mailbox, calendar) {
    if (failures.ensureCalendar) throw failures.ensureCalendar;
    const known = ensured.has(`${mailbox} ${calendar}`);
    ensured.add(`${mailbox} ${calendar}`);
    return !known;
  },
  async createEvent(mailbox, calendar, event) { call('createEvent', mailbox, event.subject, calendar); return `event-${calls.length}`; },
  async updateEvent(mailbox, id, event) { call('updateEvent', mailbox, id, event.subject); },
  async deleteEvent(mailbox, id) { call('deleteEvent', mailbox, id); },
};

const sync = (config = CONFIG) => syncOnce({ db, graph, config, log: (event, details) => logs.push({ event, ...details }), now: NOW });
const graphCalls = () => calls.filter(([name]) => name !== 'desired');

beforeEach(() => {
  reservations = [RESERVATION];
  rows = new Map();
  calls = [];
  failures = {};
  logs = [];
  spaces = [];
  ensured = new Set();
});

test('local time is the wall clock of the pool', () => {
  assert.equal(localNow('Europe/Madrid', NOW), '2026-11-12T09:00:00');
  assert.equal(localNow('Europe/Madrid', new Date('2026-07-01T22:30:00Z')), '2026-07-02T00:30:00');
});

test('asks leihs for the chosen statuses from today, creates the event and remembers it', async () => {
  await sync();
  assert.deepEqual(calls[0], ['desired', CONFIG.statuses, '2026-11-12']);
  assert.deepEqual(graphCalls(), [['createEvent', 'so@enti.cat', 'Buc 3 — Ana Puig', 'Reservas leihs']]);
  assert.equal(rows.get('r1').eventId, 'event-2');

  calls = [];
  await sync();
  assert.deepEqual(graphCalls(), [], 'nothing to do the second time');
});

test('a change of time updates the same event', async () => {
  await sync();
  reservations = [{ ...RESERVATION, end_time: '14:00' }];
  await sync();
  assert.deepEqual(graphCalls().at(-1), ['updateEvent', 'so@enti.cat', 'event-2', 'Buc 3 — Ana Puig']);
  assert.equal(rows.get('r1').endsAt, '2026-11-12T14:00:00');
});

test('an event deleted in Outlook comes back on the next change', async () => {
  await sync();
  reservations = [{ ...RESERVATION, end_time: '14:00' }];
  failures.updateEvent = new GraphError(404, 'ErrorItemNotFound', 'gone');
  await sync();
  assert.deepEqual(graphCalls().slice(-2).map(([name]) => name), ['updateEvent', 'createEvent']);
  assert.notEqual(rows.get('r1').eventId, 'event-2');
});

test('a canceled reservation deletes its event, also if it was already gone', async () => {
  await sync();
  reservations = [];
  failures.deleteEvent = new GraphError(404, 'ErrorItemNotFound', 'gone');
  await sync();
  assert.deepEqual(graphCalls().at(-1), ['deleteEvent', 'so@enti.cat', 'event-2']);
  assert.equal(rows.size, 0);
});

test('a dry run only logs what it would do', async () => {
  await sync({ ...CONFIG, dryRun: true });
  assert.deepEqual(graphCalls(), []);
  assert.equal(rows.size, 0);
  assert.equal(logs[0].event, 'would_create');
  assert.equal(logs[0].subject, 'Buc 3 — Ana Puig');
  assert.deepEqual(logs.at(-1), { event: 'dry_run_done', create: 1, update: 0, move: 0, delete: 0, forget: 0, failed: 0 });
});

test('without permission on a mailbox it tries once and skips the rest of that mailbox', async () => {
  reservations = [RESERVATION, { ...RESERVATION, reservation_id: 'r2' }, { ...RESERVATION, reservation_id: 'r3', mailbox: 'otro@enti.cat' }];
  failures.createEvent = new GraphError(403, 'ErrorAccessDenied', 'Access is denied');
  const { counts } = await sync();
  assert.deepEqual(graphCalls().map(([, mailbox]) => mailbox), ['so@enti.cat', 'otro@enti.cat']);
  assert.equal(counts.failed, 2);
  assert.equal(rows.size, 0, 'failed events are retried next round');
});

test('when Microsoft asks to wait, the round stops and says how long', async () => {
  reservations = [RESERVATION, { ...RESERVATION, reservation_id: 'r2' }];
  failures.createEvent = new GraphError(429, 'TooManyRequests', 'slow down', 30);
  const { retryAfterSeconds } = await sync();
  assert.equal(retryAfterSeconds, 30);
  assert.equal(graphCalls().length, 1);
});

test('items keep the mailbox of the category', () => {
  assert.equal(itemFor({ ...RESERVATION, mailbox: 'otro@enti.cat' }, CONFIG).mailbox, 'otro@enti.cat');
});

test('with a calendar group, each space gets its own calendar', async () => {
  const group = { ...CONFIG, calendarGroup: 'Reservas leihs' };
  reservations = [RESERVATION, { ...RESERVATION, reservation_id: 'r2', model_name: 'Sala de Control' }];
  await sync(group);
  assert.deepEqual(graphCalls().map(([, , , calendar]) => calendar), ['Buc 3', 'Sala de Control']);
  assert.equal(rows.get('r2').calendar, 'Sala de Control');
});

test('turning the group on moves the events created before into their space', async () => {
  await sync();
  rows.get('r1').calendar = null; // as rows from before the calendar was recorded
  calls = [];
  await sync({ ...CONFIG, calendarGroup: 'Reservas leihs' });
  assert.deepEqual(graphCalls(), [
    ['deleteEvent', 'so@enti.cat', 'event-2'],
    ['createEvent', 'so@enti.cat', 'Buc 3 — Ana Puig', 'Buc 3'],
  ]);
  assert.equal(rows.get('r1').calendar, 'Buc 3');
});

test('rows from before the calendar was recorded stay put without a group', async () => {
  await sync();
  rows.get('r1').calendar = null;
  calls = [];
  await sync();
  assert.deepEqual(graphCalls(), []);
});

test('a reservation that changes space moves to that calendar, also if the old event was gone', async () => {
  const group = { ...CONFIG, calendarGroup: 'Reservas leihs' };
  await sync(group);
  reservations = [{ ...RESERVATION, model_name: 'Buc 4' }];
  failures.deleteEvent = new GraphError(404, 'ErrorItemNotFound', 'gone');
  const { counts } = await sync(group);
  assert.equal(counts.move, 1);
  assert.deepEqual(graphCalls().at(-1), ['createEvent', 'so@enti.cat', 'Buc 4 — Ana Puig', 'Buc 4']);
  assert.equal(rows.get('r1').calendar, 'Buc 4');
});

test('every space gets its calendar before its first reservation, once', async () => {
  reservations = [];
  spaces = [
    { mailbox: 'so@enti.cat', model_name: 'Buc 1' },
    { mailbox: 'so@enti.cat', model_name: 'Auditorio' },
  ];
  const config = { ...CONFIG, calendarGroup: 'Reservas leihs' };
  await sync(config);
  assert.deepEqual(logs.filter((l) => l.event === 'calendar_created').map((l) => l.calendar), ['Buc 1', 'Auditorio']);
  assert.deepEqual(graphCalls(), [], 'no events');

  logs = [];
  await sync(config);
  assert.deepEqual(logs, [], 'nothing to say the second time');
});

test('without a group the one calendar is prepared, the main calendar is not', async () => {
  spaces = [{ mailbox: 'so@enti.cat', model_name: 'Buc 1' }, { mailbox: 'so@enti.cat', model_name: 'Buc 2' }];
  reservations = [];
  await sync();
  assert.deepEqual([...ensured], ['so@enti.cat Reservas leihs']);

  ensured = new Set();
  await sync({ ...CONFIG, calendarName: '' });
  assert.deepEqual([...ensured], []);
});

test('a dry run lists the calendars it would prepare', async () => {
  spaces = [{ mailbox: 'so@enti.cat', model_name: 'Buc 1' }];
  reservations = [];
  await sync({ ...CONFIG, dryRun: true, calendarGroup: 'Reservas leihs' });
  assert.deepEqual(logs[0], { event: 'would_prepare_calendars', mailbox: 'so@enti.cat', calendars: ['Buc 1'] });
  assert.equal(ensured.size, 0);
});

test('a calendar that cannot be made skips the events of that mailbox in the round', async () => {
  spaces = [{ mailbox: 'so@enti.cat', model_name: 'Buc 3' }];
  failures.ensureCalendar = new GraphError(403, 'ErrorAccessDenied', 'no');
  await sync({ ...CONFIG, calendarGroup: 'Reservas leihs' });
  assert.equal(logs[0].event, 'calendar_failed');
  assert.deepEqual(graphCalls(), []);
});

test('when Microsoft asks to wait while preparing, the round stops there', async () => {
  spaces = [{ mailbox: 'so@enti.cat', model_name: 'Buc 3' }];
  failures.ensureCalendar = new GraphError(429, 'TooManyRequests', 'slow', 30);
  const { retryAfterSeconds } = await sync({ ...CONFIG, calendarGroup: 'Reservas leihs' });
  assert.equal(retryAfterSeconds, 30);
  assert.deepEqual(graphCalls(), []);
});
