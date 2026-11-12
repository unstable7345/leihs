import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventFor, itemFor } from '../src/events.js';
import { RESERVATION } from './fixtures.js';

const CONFIG = { timeZone: 'Europe/Madrid' };

test('a reservation by the hour is an event with times in the pool time zone', () => {
  const event = eventFor(RESERVATION, CONFIG);
  assert.equal(event.subject, 'Buc 3 — Ana Puig');
  assert.deepEqual(event.start, { dateTime: '2026-11-12T10:00:00', timeZone: 'Europe/Madrid' });
  assert.deepEqual(event.end, { dateTime: '2026-11-12T12:30:00', timeZone: 'Europe/Madrid' });
  assert.equal(event.isAllDay, false);
  assert.match(event.body.content, /Motivo: Mezcla del proyecto final/);
  assert.match(event.body.content, /Inventario: Magatzem/);
});

test('a reservation of whole days is an all-day event that ends at midnight after its last day', () => {
  const event = eventFor({ ...RESERVATION, end_date: '2026-11-30', start_time: null, end_time: null }, CONFIG);
  assert.equal(event.isAllDay, true);
  assert.equal(event.start.dateTime, '2026-11-12T00:00:00');
  assert.equal(event.end.dateTime, '2026-12-01T00:00:00');
});

test('a delegation shows who reserved for it, and an empty purpose leaves no line', () => {
  const event = eventFor({ ...RESERVATION, user_name: 'Sonido 2B', delegated_user_name: 'Pol Vidal', purpose: ' ' }, CONFIG);
  assert.equal(event.subject, 'Buc 3 — Sonido 2B (Pol Vidal)');
  assert.doesNotMatch(event.body.content, /Motivo/);
});

test('the fingerprint changes only when the event changes', () => {
  const item = itemFor(RESERVATION, CONFIG);
  assert.equal(item.fingerprint, itemFor({ ...RESERVATION }, CONFIG).fingerprint);
  assert.notEqual(item.fingerprint, itemFor({ ...RESERVATION, end_time: '13:00' }, CONFIG).fingerprint);
  assert.equal(item.endsAt, '2026-11-12T12:30:00');
});
