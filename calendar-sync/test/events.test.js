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

test('without inviteBooker there are no attendees', () => {
  const event = eventFor(RESERVATION, CONFIG);
  assert.equal(event.attendees, undefined);
  assert.equal(event.responseRequested, undefined);
});

test('with inviteBooker the person who reserved is invited, without asking for a response', () => {
  const event = eventFor(RESERVATION, { ...CONFIG, inviteBooker: true });
  assert.deepEqual(event.attendees, [
    { type: 'required', emailAddress: { address: 'ana.puig@enti.cat', name: 'Ana Puig' } },
  ]);
  assert.equal(event.responseRequested, false);
  assert.equal(event.allowNewTimeProposals, false);
});

test('in a delegation the person acting for it is invited', () => {
  const event = eventFor({ ...RESERVATION, user_name: 'Sonido 2B', delegated_user_name: 'Pol Vidal', booker_email: 'pol.vidal@enti.cat' }, { ...CONFIG, inviteBooker: true });
  assert.deepEqual(event.attendees[0].emailAddress, { address: 'pol.vidal@enti.cat', name: 'Pol Vidal' });
});

test('without an email the event is created without attendees', () => {
  const event = eventFor({ ...RESERVATION, booker_email: null }, { ...CONFIG, inviteBooker: true });
  assert.equal(event.attendees, undefined);
});

test('turning invitations on changes the fingerprint, so existing events get the attendee', () => {
  assert.notEqual(itemFor(RESERVATION, CONFIG).fingerprint, itemFor(RESERVATION, { ...CONFIG, inviteBooker: true }).fingerprint);
});

test('a space given back early ends at the return, so the next booking does not overlap it', () => {
  const event = eventFor({ ...RESERVATION, returned_at: '2026-11-12T11:25' }, CONFIG);
  assert.equal(event.start.dateTime, '2026-11-12T10:00:00');
  assert.equal(event.end.dateTime, '2026-11-12T11:25:00');
});

test('a space given back late, or with a return before it started, keeps its reserved end', () => {
  assert.equal(eventFor({ ...RESERVATION, returned_at: '2026-11-12T13:10' }, CONFIG).end.dateTime, '2026-11-12T12:30:00');
  assert.equal(eventFor({ ...RESERVATION, returned_at: '2026-11-12T09:50' }, CONFIG).end.dateTime, '2026-11-12T12:30:00');
});

test('a reservation of whole days given back early ends at midnight after the day of the return', () => {
  const days = { ...RESERVATION, end_date: '2026-11-30', start_time: null, end_time: null };
  assert.equal(eventFor({ ...days, returned_at: '2026-11-14T10:00' }, CONFIG).end.dateTime, '2026-11-15T00:00:00');
  assert.equal(eventFor({ ...days, returned_at: '2026-12-02T10:00' }, CONFIG).end.dateTime, '2026-12-01T00:00:00');
});

test('giving a space back early changes the fingerprint, so the event is updated', () => {
  const before = itemFor(RESERVATION, CONFIG);
  const after = itemFor({ ...RESERVATION, returned_at: '2026-11-12T11:25' }, CONFIG);
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.equal(after.endsAt, '2026-11-12T11:25:00');
});
