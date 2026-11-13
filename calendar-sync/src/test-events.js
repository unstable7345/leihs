import { calendarsOf } from './events.js';
import { localNow } from './sync.js';

// Test events are found again by this start of their subject.
export const TEST_SUBJECT = 'PRUEBA leihs';

function nextDay(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/**
 * A test event for tomorrow from 10:00 to 11:00. It invites nobody, shows the
 * time as free and is not recorded in leihs, so the sync never touches it.
 */
export function testEventFor(calendar, day, timeZone) {
  return {
    subject: `${TEST_SUBJECT} — ${calendar || 'calendario principal'}`,
    body: {
      contentType: 'text',
      content: 'Evento de prueba de leihs-calendar-sync, sin reserva detrás. Se borra con --test-events --remove.',
    },
    start: { dateTime: `${day}T10:00:00`, timeZone },
    end: { dateTime: `${day}T11:00:00`, timeZone },
    isAllDay: false,
    showAs: 'free',
    isReminderOn: false,
  };
}

/**
 * Puts one test event in the calendar of every space, or with remove takes
 * them all away again. Calendars that already have one are left as they are.
 * Returns the number of calendars that failed.
 */
export async function testEvents({ db, graph, config, log, remove = false, now = new Date() }) {
  const day = nextDay(localNow(config.timeZone, now).slice(0, 10));
  let failed = 0;

  for (const { mailbox, calendar } of calendarsOf(await db.spaces(), config)) {
    if (config.dryRun) {
      log(remove ? 'would_remove_test_events' : 'would_create_test_event', { mailbox, calendar });
      continue;
    }
    try {
      const existing = (await graph.listEvents(mailbox, calendar))
        .filter((event) => event.subject?.startsWith(TEST_SUBJECT));
      if (remove) {
        for (const event of existing) {
          await graph.deleteEvent(mailbox, event.id);
          log('test_event_deleted', { mailbox, calendar, subject: event.subject });
        }
      } else if (existing.length > 0) {
        log('test_event_exists', { mailbox, calendar });
      } else {
        const event = testEventFor(calendar, day, config.timeZone);
        await graph.createEvent(mailbox, calendar, event);
        log('test_event_created', { mailbox, calendar, start: event.start.dateTime });
      }
    } catch (error) {
      failed += 1;
      log('test_event_failed', { mailbox, calendar, status: error.status, error: error.message });
      if (error.retryAfterSeconds || error.status === 429) break;
    }
  }
  return failed;
}
