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
 *
 * With inviteBooker, the person who made the reservation is an attendee:
 * Exchange sends the invitation from the mailbox, and the updates and the
 * cancellation when the reservation changes or goes away. No responses are
 * asked for, so the mailbox does not fill with them.
 */
export function eventFor(reservation, { timeZone, inviteBooker = false }) {
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

  const invite = inviteBooker && reservation.booker_email;
  return {
    subject: `${reservation.model_name} — ${person}`,
    body: { contentType: 'text', content: lines.join('\n') },
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    isAllDay: allDay,
    showAs: 'busy',
    isReminderOn: false,
    ...(invite && {
      attendees: [{
        type: 'required',
        emailAddress: {
          address: reservation.booker_email,
          name: reservation.delegated_user_name || reservation.user_name,
        },
      }],
      responseRequested: false,
      allowNewTimeProposals: false,
    }),
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
