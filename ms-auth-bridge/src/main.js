import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const server = createBridge({
  publicUrl: required('PUBLIC_URL'),
  leihsBaseUrl: required('LEIHS_BASE_URL'),
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
