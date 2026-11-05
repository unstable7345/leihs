import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { decodeJwt, exportJWK, jwtVerify, SignJWT } from 'jose';
import { createBridge } from '../src/bridge.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT_ID = 'client-id';
const SECRET = 'client-secret';
const SIGN_IN_PATH = '/sign-in/external-authentication/microsoft/sign-in';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const microsoftKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

let currentTime;
let idTokenFor;
let microsoft;
let microsoftUrl;
let bridge;
let bridgeUrl;
let events;
let ensureAccount;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function signIdToken(claims, key = microsoftKeys.privateKey) {
  const issuedAt = Math.floor(currentTime.getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(key);
}

function leihsToken(claims = {}, key = privateKey) {
  const issuedAt = Math.floor(currentTime.getTime() / 1000);
  return new SignJWT({ email: 'typed@enti.cat', path: SIGN_IN_PATH, return_to: '/borrow/', ...claims })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 90)
    .sign(key);
}

function goodClaims(authorize) {
  return {
    iss: `${microsoftUrl}/${TENANT}/v2.0`,
    aud: CLIENT_ID,
    tid: TENANT,
    nonce: authorize.searchParams.get('nonce'),
    preferred_username: 'Real.User@enti.cat',
  };
}

before(async () => {
  const jwk = { ...(await exportJWK(microsoftKeys.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  microsoft = createServer(async (req, res) => {
    if (req.url.endsWith('/discovery/v2.0/keys')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    const form = new URLSearchParams(await readBody(req));
    const pendingCode = JSON.parse(form.get('code'));
    const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64url');
    const authentic = form.get('client_secret') === SECRET
      && form.get('redirect_uri') === `${bridgeUrl}/ms-auth/callback`
      && challenge === pendingCode.challenge;
    if (!authentic) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }
    const idToken = await idTokenFor(new URL(pendingCode.authorize));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id_token: idToken }));
  });
  microsoftUrl = await listen(microsoft);

  // The port is needed in the configuration, so reserve it before building the bridge.
  const reservation = createServer();
  const reservedUrl = await listen(reservation);
  await new Promise((resolve) => { reservation.close(resolve); });
  bridgeUrl = reservedUrl;
  bridge = createBridge({
    publicUrl: `${bridgeUrl}/ms-auth`,
    leihsBaseUrl: 'https://leihs.example',
    tenantId: TENANT,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    identityClaim: 'preferred_username',
    privateKey,
    authority: microsoftUrl,
    accounts: { ensure: (...args) => ensureAccount(...args) },
    now: () => currentTime,
    log: (event, details) => events.push({ event, ...details }),
  });
  await new Promise((resolve) => {
    bridge.listen(Number(new URL(bridgeUrl).port), '127.0.0.1', resolve);
  });
});

after(() => {
  bridge.close();
  microsoft.close();
  bridge.closeAllConnections();
  microsoft.closeAllConnections();
});

beforeEach(() => {
  currentTime = new Date();
  events = [];
  idTokenFor = (authorize) => signIdToken(goodClaims(authorize));
  ensureAccount = async () => true;
});

async function start(token) {
  const response = await fetch(`${bridgeUrl}/ms-auth/sign-in?token=${token ?? await leihsToken()}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  return {
    authorize: new URL(response.headers.get('location')),
    cookie: response.headers.get('set-cookie').split(';')[0],
    setCookie: response.headers.get('set-cookie'),
  };
}

function callback({ authorize, cookie }, params) {
  const code = JSON.stringify({
    authorize: authorize.href,
    challenge: authorize.searchParams.get('code_challenge'),
  });
  const query = new URLSearchParams({ state: authorize.searchParams.get('state'), code, ...params });
  return fetch(`${bridgeUrl}/ms-auth/callback?${query}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
}

test('sends the user to the tenant with PKCE, state, nonce and a login hint', async () => {
  const { authorize, setCookie } = await start();
  assert.equal(authorize.origin + authorize.pathname, `${microsoftUrl}/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(authorize.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${bridgeUrl}/ms-auth/callback`);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('login_hint'), 'typed@enti.cat');
  assert.ok(authorize.searchParams.get('state'));
  assert.ok(authorize.searchParams.get('nonce'));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/ms-auth\//);
});

test('returns to leihs with a token leihs can verify, using the Microsoft identity', async () => {
  const response = await callback(await start());
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin + location.pathname, `https://leihs.example${SIGN_IN_PATH}`);

  const { payload } = await jwtVerify(location.searchParams.get('token'), publicKey, {
    algorithms: ['ES256'],
    currentDate: currentTime,
  });
  assert.equal(payload.success, true);
  assert.equal(payload.email, 'real.user@enti.cat', 'never the address typed into leihs');

  const request = await jwtVerify(payload.sign_in_request_token, publicKey, {
    algorithms: ['ES256'],
    currentDate: currentTime,
  });
  assert.equal(request.payload.return_to, '/borrow/');
  assert.deepEqual(events.at(-1), { event: 'sign_in', identity: 'real.user@enti.cat' });
});

test('a sign-in slower than the 90 second leihs token still returns a valid request token', async () => {
  const flow = await start();
  currentTime = new Date(currentTime.getTime() + 5 * 60 * 1000);
  const response = await callback(flow);
  assert.equal(response.status, 302);
  const token = new URL(response.headers.get('location')).searchParams.get('token');
  const { sign_in_request_token: requestToken } = decodeJwt(token);
  const { payload } = await jwtVerify(requestToken, publicKey, { algorithms: ['ES256'], currentDate: currentTime });
  assert.equal(payload.return_to, '/borrow/');
  assert.ok(payload.exp > currentTime.getTime() / 1000);
});

test('rejects sign-in requests leihs did not sign, or that expired', async () => {
  const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const forged = await leihsToken({}, stranger);
  const forgedResponse = await fetch(`${bridgeUrl}/ms-auth/sign-in?token=${forged}`, { redirect: 'manual' });
  assert.equal(forgedResponse.status, 400);

  const late = await leihsToken();
  currentTime = new Date(currentTime.getTime() + 91 * 1000);
  const lateResponse = await fetch(`${bridgeUrl}/ms-auth/sign-in?token=${late}`, { redirect: 'manual' });
  assert.equal(lateResponse.status, 400);

  const missing = await fetch(`${bridgeUrl}/ms-auth/sign-in`, { redirect: 'manual' });
  assert.equal(missing.status, 400);
});

test('rejects a signed token whose path is not a leihs sign-in path', async () => {
  const token = await leihsToken({ path: '//evil.example/sign-in' });
  const response = await fetch(`${bridgeUrl}/ms-auth/sign-in?token=${token}`, { redirect: 'manual' });
  assert.equal(response.status, 400);
});

test('rejects a callback from another browser, and an unknown or reused state', async () => {
  const flow = await start();
  assert.equal((await callback({ ...flow, cookie: undefined })).status, 400);
  assert.equal((await callback(flow)).status, 400, 'the failed attempt consumed the state');

  const second = await start();
  assert.equal((await callback(second)).status, 302);
  assert.equal((await callback(second)).status, 400, 'a state only works once');

  const third = await start();
  assert.equal((await callback(third, { state: 'made-up' })).status, 400);
});

test('reports errors from Microsoft without showing the details', async () => {
  const response = await callback(await start(), {
    error: 'access_denied',
    error_description: '<script>alert(1)</script>',
  });
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes('<script>'));
  assert.match(events.at(-1).reason, /access_denied/);
});

const badIdTokens = {
  'another signing key': (authorize) => signIdToken(goodClaims(authorize), strangerKeys.privateKey),
  'another issuer': (authorize) => signIdToken({ ...goodClaims(authorize), iss: 'https://evil.example' }),
  'another audience': (authorize) => signIdToken({ ...goodClaims(authorize), aud: 'another-app' }),
  'another tenant': (authorize) => signIdToken({ ...goodClaims(authorize), tid: 'other-tenant' }),
  'another nonce': (authorize) => signIdToken({ ...goodClaims(authorize), nonce: 'other' }),
  'no identity claim': (authorize) => signIdToken({ ...goodClaims(authorize), preferred_username: undefined }),
  'an identity that is not an address': (authorize) => signIdToken({ ...goodClaims(authorize), preferred_username: 'someone' }),
};

for (const [name, build] of Object.entries(badIdTokens)) {
  test(`does not sign in with an id token that has ${name}`, async () => {
    idTokenFor = build;
    const response = await callback(await start());
    assert.notEqual(response.status, 302);
    assert.equal(response.headers.get('location'), null);
  });
}

test('prepares the account with the verified identity before returning to leihs', async () => {
  const calls = [];
  ensureAccount = async (...args) => { calls.push(args); };
  const response = await callback(await start());
  assert.equal(response.status, 302);
  assert.equal(calls.length, 1);
  const [identity, claims, authSystemId] = calls[0];
  assert.equal(identity, 'real.user@enti.cat');
  assert.equal(claims.tid, TENANT);
  assert.equal(authSystemId, 'microsoft');
});

test('does not touch accounts when the identity fails verification', async () => {
  const calls = [];
  ensureAccount = async (...args) => { calls.push(args); };
  idTokenFor = badIdTokens['another nonce'];
  assert.notEqual((await callback(await start())).status, 302);
  assert.deepEqual(calls, []);
});

test('still returns to leihs when the account step fails, and logs why', async () => {
  ensureAccount = async () => { throw new Error('user search failed with status 401'); };
  const response = await callback(await start());
  assert.equal(response.status, 302);
  assert.deepEqual(events.find((e) => e.event === 'account_failed'), {
    event: 'account_failed',
    identity: 'real.user@enti.cat',
    reason: 'user search failed with status 401',
  });
});

test('answers the health check and rejects other routes and methods', async () => {
  assert.equal((await fetch(`${bridgeUrl}/ms-auth/health`)).status, 200);
  assert.equal((await fetch(`${bridgeUrl}/ms-auth/other`)).status, 404);
  assert.equal((await fetch(`${bridgeUrl}/ms-auth/callback`, { method: 'POST' })).status, 405);
});
