import { itemFor } from './events.js';
import { plan } from './plan.js';

/** Date and time on the wall clock of timeZone, "YYYY-MM-DDTHH:MM:SS". */
export function localNow(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date).replace(' ', 'T');
}

function describe(action) {
  const item = action.item;
  if (item) {
    return {
      reservation: item.reservationId,
      mailbox: item.mailbox,
      subject: item.event.subject,
      start: item.event.start.dateTime,
      end: item.event.end.dateTime,
    };
  }
  return { reservation: action.row.reservationId, mailbox: action.row.mailbox, event: action.row.eventId };
}

const isNotFound = (error) => error.status === 404;

// Errors that will repeat for every event of the mailbox in this round:
// no permission on it, or a mailbox that does not exist.
const isMailboxError = (error) => [401, 403].includes(error.status)
  || ['ErrorAccessDenied', 'MailboxNotEnabledForRESTAPI', 'ErrorInvalidUser', 'ResourceNotFound'].includes(error.code);

async function apply(action, { db, graph }) {
  switch (action.type) {
    case 'create': {
      const eventId = await graph.createEvent(action.item.mailbox, action.item.event);
      await db.save(action.item, eventId);
      return;
    }
    case 'update':
      try {
        await graph.updateEvent(action.item.mailbox, action.eventId, action.item.event);
        await db.save(action.item, action.eventId);
      } catch (error) {
        // Somebody deleted it in Outlook: leihs is the reference, so it comes back.
        if (!isNotFound(error)) throw error;
        await apply({ type: 'create', item: action.item }, { db, graph });
      }
      return;
    case 'delete':
      try {
        await graph.deleteEvent(action.row.mailbox, action.row.eventId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await db.remove(action.row);
      return;
    case 'forget':
      await db.remove(action.row);
      return;
    default:
      throw new Error(`unknown action ${action.type}`);
  }
}

/**
 * One round: reads leihs, compares with the calendars and applies the
 * differences. With dryRun it only logs what it would do. Returns the number
 * of seconds Microsoft asked to wait, if it did.
 */
export async function syncOnce({ db, graph, config, log, now = new Date() }) {
  const today = localNow(config.timeZone, now).slice(0, 10);
  const desired = (await db.desired(config.statuses, today)).map((row) => itemFor(row, config));
  const actions = plan(desired, await db.synced(), localNow(config.timeZone, now));

  const counts = { create: 0, update: 0, delete: 0, forget: 0, failed: 0 };
  const failedMailboxes = new Set();
  let retryAfterSeconds;

  for (const action of actions) {
    const mailbox = action.item?.mailbox ?? action.row.mailbox;
    if (config.dryRun) {
      log(`would_${action.type}`, describe(action));
      counts[action.type] += 1;
      continue;
    }
    if (failedMailboxes.has(mailbox) && action.type !== 'forget') continue;
    try {
      await apply(action, { db, graph });
      counts[action.type] += 1;
      if (action.type !== 'forget') log(action.type, describe(action));
    } catch (error) {
      counts.failed += 1;
      log(`${action.type}_failed`, { ...describe(action), status: error.status, error: error.message });
      if (error.retryAfterSeconds || error.status === 429) {
        retryAfterSeconds = error.retryAfterSeconds ?? 60;
        break;
      }
      if (isMailboxError(error)) failedMailboxes.add(mailbox);
    }
  }

  if (actions.length > 0 || config.dryRun) log(config.dryRun ? 'dry_run_done' : 'round_done', counts);
  return { counts, retryAfterSeconds };
}
