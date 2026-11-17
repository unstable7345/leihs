import { calendarsOf } from './events.js';
import { localNow } from './sync.js';

// Events of the sync say so at the end of their text (see eventFor).
const LEIHS_TEXT = 'Evento creado por leihs';
const YEARS_AHEAD = 2;

/** An event the sync made: it carries a reservation, or (older events) the text of leihs. */
export const fromLeihs = (event) => !!event.reservationId || !!event.bodyPreview?.includes(LEIHS_TEXT);

/**
 * Events made by the sync, not over yet, that leihs no longer knows: left
 * behind when Microsoft created an event but its answer never arrived, so the
 * next round created it again. Lists them, and with remove deletes them.
 * Events made by hand and test events are never touched. Returns the number
 * of calendars that failed.
 */
export async function orphans({ db, graph, config, log, remove = false, now = new Date() }) {
  const nowLocal = localNow(config.timeZone, now);
  const today = nowLocal.slice(0, 10);
  const until = `${Number(today.slice(0, 4)) + YEARS_AHEAD}${today.slice(4)}`;
  let failed = 0;
  let found = 0;
  let removed = 0;

  for (const { mailbox, calendar } of calendarsOf(await db.spaces(), config)) {
    try {
      const events = await graph.listEventsBetween(mailbox, calendar, `${today}T00:00:00`, `${until}T00:00:00`, config.timeZone);
      // Read after the events, so one the running service just created is known.
      const known = new Set((await db.synced()).map((row) => `${row.mailbox} ${row.eventId}`));
      // Events already over are history: the sync forgets them on purpose.
      const left = events.filter((e) => fromLeihs(e) && !known.has(`${mailbox} ${e.id}`) && e.end?.dateTime > nowLocal);
      for (const event of left) {
        found += 1;
        const details = {
          mailbox,
          ...(calendar && { calendar }),
          subject: event.subject,
          start: event.start?.dateTime?.slice(0, 16),
          end: event.end?.dateTime?.slice(0, 16),
          ...(event.reservationId && { reservation: event.reservationId }),
        };
        if (remove) {
          await graph.deleteEvent(mailbox, event.id);
          removed += 1;
          log('orphan_deleted', details);
        } else {
          log('orphan', details);
        }
      }
    } catch (error) {
      failed += 1;
      log('orphans_failed', { mailbox, calendar, status: error.status, error: error.message });
      if (error.retryAfterSeconds || error.status === 429) break;
    }
  }
  log('orphans_done', { found, removed, failed });
  return failed;
}
