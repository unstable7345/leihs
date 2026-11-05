import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAccounts } from './accounts.js';
import { createBridge } from './bridge.js';

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const tenantId = required('MS_TENANT_ID');
if (!GUID.test(tenantId)) {
  console.error('MS_TENANT_ID must be the tenant GUID, not a domain, "common" or "organizations"');
  process.exit(1);
}

const leihsBaseUrl = required('LEIHS_BASE_URL');

// Accounts are only created when both settings are present.
const apiToken = process.env.LEIHS_API_TOKEN?.trim();
const emailDomains = (process.env.SIGN_UP_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
if (Boolean(apiToken) !== emailDomains.length > 0) {
  console.error('LEIHS_API_TOKEN and SIGN_UP_EMAIL_DOMAINS must be set together');
  process.exit(1);
}

const server = createBridge({
  publicUrl: required('PUBLIC_URL'),
  leihsBaseUrl,
  accounts: apiToken
    ? createAccounts({
      apiUrl: process.env.LEIHS_API_URL?.trim() || leihsBaseUrl,
      apiToken,
      emailDomains,
    })
    : undefined,
  tenantId: tenantId.toLowerCase(),
  clientId: required('MS_CLIENT_ID'),
  clientSecret: required('MS_CLIENT_SECRET'),
  identityClaim: process.env.MS_IDENTITY_CLAIM?.trim() || 'preferred_username',
  privateKey: createPrivateKey(readFileSync(required('SIGNING_PRIVATE_KEY_FILE'))),
});

const port = Number(process.env.PORT || 3999);
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'listening', port }));
});
