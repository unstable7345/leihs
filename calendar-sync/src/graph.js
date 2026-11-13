const TIMEOUT_MS = 15_000;
const TOKEN_MARGIN_MS = 5 * 60_000;

export class GraphError extends Error {
  constructor(status, code, message, retryAfterSeconds) {
    super(`${status} ${code ?? ''}: ${message ?? ''}`.trim());
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function errorFrom(response) {
  let code;
  let message;
  try {
    ({ code, message } = (await response.json()).error ?? {});
  } catch {
    message = response.statusText;
  }
  const retryAfter = Number(response.headers.get('retry-after'));
  return new GraphError(response.status, code, message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}

/**
 * Microsoft Graph with the client credentials grant: no user signs in, and
 * Exchange decides which mailboxes the app may reach.
 */
export function createGraph({
  tenantId,
  clientId,
  clientSecret,
  calendarGroup = '',
  graphUrl = 'https://graph.microsoft.com/v1.0',
  tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
}) {
  let token;
  const calendarIds = new Map();
  const groupIds = new Map();

  async function accessToken() {
    if (token && Date.now() < token.expiresAt - TOKEN_MARGIN_MS) return token.value;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new GraphError(response.status, body.error, body.error_description?.split('\n')[0]);
    }
    const body = await response.json();
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function request(method, path, body) {
    // Paging links come back as whole URLs.
    const target = path.startsWith('https://') || path.startsWith('http://') ? path : `${graphUrl}${path}`;
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw await errorFrom(response);
    return response.status === 204 ? null : response.json();
  }

  const user = (mailbox) => `/users/${encodeURIComponent(mailbox)}`;
  const byName = (items, name) => items.find((item) => item.name === name);

  /** Path of the calendar group of the mailbox, created if it is missing. */
  async function groupPath(mailbox) {
    if (!groupIds.has(mailbox)) {
      const { value } = await request('GET', `${user(mailbox)}/calendarGroups?$select=id,name&$top=100`);
      const group = byName(value, calendarGroup)
        ?? (await request('POST', `${user(mailbox)}/calendarGroups`, { name: calendarGroup }));
      groupIds.set(mailbox, group.id);
    }
    return `${user(mailbox)}/calendarGroups/${encodeURIComponent(groupIds.get(mailbox))}`;
  }

  /**
   * A calendar of the mailbox, created if it is missing: inside the calendar
   * group when there is one. An empty name is the main calendar. Says whether
   * this call created it.
   */
  async function calendar(mailbox, calendarName) {
    if (!calendarName) return { path: `${user(mailbox)}/calendar`, created: false };
    const key = `${mailbox}\n${calendarName}`;
    let created = false;
    if (!calendarIds.has(key)) {
      const parent = calendarGroup ? await groupPath(mailbox) : user(mailbox);
      const { value } = await request('GET', `${parent}/calendars?$select=id,name&$top=200`);
      let found = byName(value, calendarName);
      if (!found) {
        found = await request('POST', `${parent}/calendars`, { name: calendarName });
        created = true;
      }
      calendarIds.set(key, found.id);
    }
    return { path: `${user(mailbox)}/calendars/${encodeURIComponent(calendarIds.get(key))}`, created };
  }

  return {
    /** Makes sure the calendar exists; true when this call created it. */
    async ensureCalendar(mailbox, calendarName) {
      return (await calendar(mailbox, calendarName)).created;
    },

    /** Id and subject of every event of the calendar. */
    async listEvents(mailbox, calendarName) {
      let next = `${(await calendar(mailbox, calendarName)).path}/events?$select=id,subject&$top=100`;
      const events = [];
      while (next) {
        const page = await request('GET', next);
        events.push(...page.value);
        next = page['@odata.nextLink'];
      }
      return events;
    },

    async createEvent(mailbox, calendarName, event) {
      const created = await request('POST', `${(await calendar(mailbox, calendarName)).path}/events`, event);
      return created.id;
    },

    async updateEvent(mailbox, eventId, event) {
      await request('PATCH', `${user(mailbox)}/events/${encodeURIComponent(eventId)}`, event);
    },

    async deleteEvent(mailbox, eventId) {
      await request('DELETE', `${user(mailbox)}/events/${encodeURIComponent(eventId)}`);
    },
  };
}
