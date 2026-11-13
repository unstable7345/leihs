import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plan } from '../src/plan.js';

const NOW = '2026-11-12T09:00:00';
const item = (reservationId, fingerprint = 'f1', mailbox = 'so@enti.cat', calendar = '') => ({ reservationId, mailbox, calendar, fingerprint, endsAt: '2026-11-12T12:00:00' });
const row = (reservationId, fields = {}) => ({ reservationId, mailbox: 'so@enti.cat', eventId: `e-${reservationId}`, fingerprint: 'f1', endsAt: '2026-11-12T12:00:00', ...fields });

test('new reservations are created and unchanged ones are left alone', () => {
  assert.deepEqual(plan([item('a'), item('b')], [row('a')], NOW), [{ type: 'create', item: item('b') }]);
});

test('a changed reservation updates its event', () => {
  assert.deepEqual(plan([item('a', 'f2')], [row('a')], NOW), [{ type: 'update', item: item('a', 'f2'), eventId: 'e-a' }]);
});

test('an event no longer wanted is deleted before it ends and forgotten after', () => {
  const future = row('a');
  const past = row('b', { endsAt: '2026-11-11T18:00:00' });
  assert.deepEqual(plan([], [future, past], NOW), [{ type: 'delete', row: future }, { type: 'forget', row: past }]);
});

test('moving a category to another mailbox deletes in the old calendar and creates in the new one', () => {
  const moved = item('a', 'f1', 'otro@enti.cat');
  assert.deepEqual(plan([moved], [row('a')], NOW), [{ type: 'create', item: moved }, { type: 'delete', row: row('a') }]);
});

test('an event whose calendar changed is moved, rows without a calendar count as the default one', () => {
  const inBuc1 = item('a', 'f1', 'so@enti.cat', 'Buc 1');
  assert.deepEqual(plan([inBuc1], [row('a', { calendar: 'Buc 2' })], NOW), [{ type: 'move', item: inBuc1, row: row('a', { calendar: 'Buc 2' }) }]);
  assert.deepEqual(plan([item('a', 'f1', 'so@enti.cat', 'Reservas leihs')], [row('a')], NOW, 'Reservas leihs'), []);
  assert.equal(plan([inBuc1], [row('a')], NOW, 'Reservas leihs')[0].type, 'move');
});
