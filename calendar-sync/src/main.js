import pg from 'pg';
import { createGraph } from './graph.js';
import { createLeihsDb } from './leihs.js';
import { syncOnce } from './sync.js';

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STATUSES = ['submitted', 'approved', 'signed', 'closed'];

const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const dryRun = args.has('--dry-run');

const log = (event, details) => console.log(JSON.stringify({ event, ...details }));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing environment variable ${name}`);
  return value;
}

const statuses = (process.env.SYNC_STATUSES ?? 'approved,signed,closed')
  .split(',')
  .map((status) => status.trim())
  .filter(Boolean);
const unknown = statuses.filter((status) => !STATUSES.includes(status));
if (statuses.length === 0 || unknown.length > 0) {
  fail(`SYNC_STATUSES must be a list of ${STATUSES.join(', ')}`);
}

const config = {
  dryRun,
  statuses,
  timeZone: process.env.TIME_ZONE?.trim() || 'Europe/Madrid',
};
const intervalSeconds = Number(process.env.SYNC_INTERVAL_SECONDS || 60);

// A dry run never talks to Microsoft, so it works before the permission exists.
let graph;
if (!dryRun) {
  const tenantId = required('MS_TENANT_ID');
  if (!GUID.test(tenantId)) fail('MS_TENANT_ID must be the tenant GUID');
  graph = createGraph({
    tenantId,
    clientId: required('MS_CLIENT_ID'),
    clientSecret: required('MS_CLIENT_SECRET'),
    calendarName: process.env.CALENDAR_NAME?.trim() ?? '',
  });
}

// The database settings of leihs itself (/etc/leihs/config.env), or the usual PG* variables.
const env = process.env;
const pool = new pg.Pool({
  host: env.PGHOST ?? env.DB_HOST ?? 'localhost',
  port: Number(env.PGPORT ?? env.DB_PORT ?? 5432),
  database: env.PGDATABASE ?? env.DB_NAME,
  user: env.PGUSER ?? env.DB_USER,
  password: env.PGPASSWORD ?? env.DB_PASSWORD,
  max: 2,
});
const db = createLeihsDb(pool);

let stopping = false;
let timer;
let wake;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    clearTimeout(timer);
    wake?.();
  });
}

const sleep = (seconds) => new Promise((resolve) => {
  wake = resolve;
  timer = setTimeout(resolve, seconds * 1000);
});

log('started', { dryRun, once, statuses, timeZone: config.timeZone, intervalSeconds });
do {
  let pause = intervalSeconds;
  try {
    const { retryAfterSeconds } = await syncOnce({ db, graph, config, log });
    if (retryAfterSeconds) pause = Math.max(pause, retryAfterSeconds);
  } catch (error) {
    log('round_failed', { error: error.message });
    if (once) process.exitCode = 1;
  }
  if (once || stopping) break;
  await sleep(pause);
} while (!stopping);

await pool.end();
