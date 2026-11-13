const keyOf = ({ reservationId, mailbox }) => `${reservationId} ${mailbox}`;

/**
 * Compares what should be in the calendars with what was put there before.
 *
 * desired: items from itemFor, for reservations that end today or later.
 * synced: rows of outlook_calendar_events.
 * now: local date and time, "YYYY-MM-DDTHH:MM:SS".
 *
 * An event whose calendar changed (one calendar per space, and the reservation
 * moved to another space) is moved: Outlook cannot move events between
 * calendars, so it is deleted and created again. Rows from before calendars
 * were recorded have none, and count as being in defaultCalendar.
 *
 * An event that is no longer wanted is deleted while it has not ended. Once it
 * has ended it stays in the calendar as history and is only forgotten here,
 * which is also what happens to every reservation when its last day is over.
 */
export function plan(desired, synced, now, defaultCalendar = '') {
  const syncedByKey = new Map(synced.map((row) => [keyOf(row), row]));
  const actions = [];

  for (const item of desired) {
    const row = syncedByKey.get(keyOf(item));
    syncedByKey.delete(keyOf(item));
    if (!row) {
      actions.push({ type: 'create', item });
    } else if ((row.calendar ?? defaultCalendar) !== item.calendar) {
      actions.push({ type: 'move', item, row });
    } else if (row.fingerprint !== item.fingerprint) {
      actions.push({ type: 'update', item, eventId: row.eventId });
    }
  }

  for (const row of syncedByKey.values()) {
    actions.push({ type: row.endsAt > now ? 'delete' : 'forget', row });
  }

  return actions;
}
