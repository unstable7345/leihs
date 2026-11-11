import { createHash } from 'node:crypto';

function nextDay(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function personOf(reservation) {
  const { user_name: user, delegated_user_name: delegated } = reservation;
  return delegated ? `${user} (${delegated})` : user;
}

/**
 * The Outlook event for a reservation, as Microsoft Graph takes it. Times are
 * local to the inventory pool: leihs stores them without a time zone.
 */
export function eventFor(reservation, { timeZone }) {
  const allDay = !reservation.start_time;
  const start = allDay
    ? `${reservation.start_date}T00:00:00`
    : `${reservation.start_date}T${reservation.start_time}:00`;
  // An all-day event ends at midnight after its last day.
  const end = allDay
    ? `${nextDay(reservation.end_date)}T00:00:00`
    : `${reservation.end_date}T${reservation.end_time}:00`;
  const person = personOf(reservation);
  const lines = [
    `Reservado por: ${person}`,
    ...(reservation.purpose?.trim() ? [`Motivo: ${reservation.purpose.trim()}`] : []),
    `Inventario: ${reservation.pool_name}`,
    '',
    'Evento creado por leihs. Los cambios se hacen en leihs: los que se hagan aquí se pierden.',
  ];

  return {
    subject: `${reservation.model_name} — ${person}`,
    body: { contentType: 'text', content: lines.join('\n') },
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    isAllDay: allDay,
    showAs: 'busy',
    isReminderOn: false,
  };
}

/** Everything the sync needs to know about one reservation in one calendar. */
export function itemFor(reservation, config) {
  const event = eventFor(reservation, config);
  return {
    reservationId: reservation.reservation_id,
    mailbox: reservation.mailbox,
    event,
    fingerprint: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    endsAt: event.end.dateTime,
  };
}
