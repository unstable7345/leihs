import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fromLeihs, orphans } from '../src/orphans.js';

const CONFIG = { timeZone: 'Europe/Madrid', calendarGroup: 'Reservas leihs', calendarName: '' };
const NOW = new Date('2026-11-17T11:00:00Z'); // 12:00 in Madrid
const LEIHS = 'Reservado por: Paula\nEvento creado por leihs. Los cambios se hacen en leihs…';

let events; // "mailbox calendar" → events
let rows;
let deleted;
let logs;
let asked;

const db = {
  async spaces() {
    return [{ mailbox: 'so@enti.cat', model_name: 'Buc 4' }, { mailbox: 'so@enti.cat', model_name: 'Buc 5' }];
  },
  async synced() { return rows; },
};

const graph = {
  async listEventsBetween(mailbox, calendar, start, end, timeZone) {
    asked.push([calendar, start, end, timeZone]);
    return events[`${mailbox} ${calendar}`] ?? [];
  },
  async deleteEvent(mailbox, id) { deleted.push(id); },
};

const event = (id, end, more = {}) => ({
  id, subject: `Buc 4 — ${id}`, bodyPreview: LEIHS, start: { dateTime: `${end.slice(0, 11)}09:00:00.0000000` }, end: { dateTime: `${end}.0000000` }, ...more,
});

const run = (remove = false) => orphans({ db, graph, config: CONFIG, log: (e, d) => logs.push({ event: e, ...d }), remove, now: NOW });

beforeEach(() => {
  rows = [{ reservationId: 'r1', mailbox: 'so@enti.cat', eventId: 'kept' }];
  events = {
    'so@enti.cat Buc 4': [
      event('kept', '2026-11-18T17:00:00'),
      event('twin', '2026-11-18T17:00:00'), // the second one of the same reservation
      event('by-hand', '2026-11-19T12:00:00', { bodyPreview: 'Reunión' }),
      event('over', '2026-11-17T11:00:00'), // ended this morning: history
      event('tagged', '2026-11-20T12:00:00', { bodyPreview: '', reservationId: 'r9' }),
    ],
  };
  deleted = [];
  logs = [];
  asked = [];
});

test('an event is from leihs when it carries a reservation or says so', () => {
  assert.equal(fromLeihs({ reservationId: 'r1' }), true);
  assert.equal(fromLeihs({ bodyPreview: LEIHS }), true);
  assert.equal(fromLeihs({ bodyPreview: 'Reunión' }), false);
  assert.equal(fromLeihs({}), false);
});

test('lists the events of leihs that leihs does not know and are not over, without deleting', async () => {
  const failed = await run();
  assert.equal(failed, 0);
  assert.deepEqual(asked[0], ['Buc 4', '2026-11-17T00:00:00', '2028-11-17T00:00:00', 'Europe/Madrid']);
  assert.deepEqual(logs.filter((l) => l.event === 'orphan').map((l) => l.subject), ['Buc 4 — twin', 'Buc 4 — tagged']);
  assert.deepEqual(logs.find((l) => l.event === 'orphan'), {
    event: 'orphan', mailbox: 'so@enti.cat', calendar: 'Buc 4', subject: 'Buc 4 — twin', start: '2026-11-18T09:00', end: '2026-11-18T17:00',
  });
  assert.deepEqual(deleted, []);
  assert.deepEqual(logs.at(-1), { event: 'orphans_done', found: 2, removed: 0, failed: 0 });
});

test('with remove it deletes them, and nothing else', async () => {
  await run(true);
  assert.deepEqual(deleted, ['twin', 'tagged']);
  assert.deepEqual(logs.at(-1), { event: 'orphans_done', found: 2, removed: 2, failed: 0 });
});

test('a calendar that fails is counted and the others go on', async () => {
  const { listEventsBetween } = graph;
  graph.listEventsBetween = async (mailbox, calendar, ...rest) => {
    if (calendar === 'Buc 4') throw Object.assign(new Error('boom'), { status: 500 });
    return listEventsBetween(mailbox, calendar, ...rest);
  };
  try {
    assert.equal(await run(), 1);
  } finally {
    graph.listEventsBetween = listEventsBetween;
  }
  assert.equal(logs.find((l) => l.event === 'orphans_failed').calendar, 'Buc 4');
});
