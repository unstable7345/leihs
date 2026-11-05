import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

const TOKEN_LIFETIME_SECONDS = 90;
const PENDING_LIFETIME_MS = 10 * 60 * 1000;
const COOKIE_NAME = 'leihs_ms_auth';
const LEIHS_SIGN_IN_PATH = /^\/sign-in\/external-authentication\/[^/?#]+\/sign-in$/;

const randomToken = () => randomBytes(32).toString('base64url');

export class BridgeError extends Error {}

/**
 * Verifies a token that leihs signed. leihs signs the request with
 * internal_private_key; this bridge holds the same key pair.
 */
export async function verifyLeihsToken(token, privateKey, now = new Date()) {
  const { payload } = await jwtVerify(token, createPublicKey(privateKey), {
    algorithms: ['ES256'],
    currentDate: now,
  });
  return payload;
}

function signToken(claims, privateKey, now) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
    .sign(privateKey);
}

/**
 * Builds the token leihs expects back. leihs verifies the embedded
 * sign_in_request_token again, and the original expires 90 seconds after the
 * user left leihs, which an MFA prompt easily outlasts. It is re-signed with
 * the same claims (return_to included) so that a slow sign-in still works.
 */
export async function buildSignInToken(identity, requestClaims, privateKey, now = new Date()) {
  const signInRequestToken = await signToken(requestClaims, privateKey, now);
  return signToken(
    { email: identity, success: true, sign_in_request_token: signInRequestToken },
    privateKey,
    now,
  );
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function errorPage(res, status, leihsBaseUrl) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="ca">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>leihs</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">No s'ha pogut iniciar la sessió</h1>
<p>No se ha podido iniciar la sesión con Microsoft. Torna-ho a provar / Vuelve a intentarlo.</p>
<p><a href="${new URL('/', leihsBaseUrl).href}">leihs</a></p>
</body>
</html>`);
}

export function createBridge(config) {
  const { publicUrl, leihsBaseUrl, tenantId, clientId, clientSecret, identityClaim, privateKey } = config;
  const authority = `${config.authority ?? 'https://login.microsoftonline.com'}/${tenantId}`;
  const issuer = config.issuer ?? `${authority}/v2.0`;
  const jwks = createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`));
  const clock = config.now ?? (() => new Date());
  const log = config.log ?? ((event, details) => console.log(JSON.stringify({ event, ...details })));

  const basePath = new URL(publicUrl).pathname.replace(/\/$/, '');
  const redirectUri = `${publicUrl.replace(/\/$/, '')}/callback`;
  const secureCookie = publicUrl.startsWith('https:') ? '; Secure' : '';
  const pending = new Map();

  function purgeExpired() {
    const nowMs = clock().getTime();
    for (const [state, entry] of pending) {
      if (entry.expiresAt <= nowMs) pending.delete(state);
    }
  }

  async function startSignIn(req, res, url) {
    let requestClaims;
    try {
      requestClaims = await verifyLeihsToken(url.searchParams.get('token') ?? '', privateKey, clock());
    } catch (error) {
      throw new BridgeError(`invalid leihs token: ${error.code ?? error.message}`);
    }
    if (!LEIHS_SIGN_IN_PATH.test(requestClaims.path ?? '')) {
      throw new BridgeError('leihs token has an unexpected path');
    }

    purgeExpired();
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    // A browser keeps one binding value so that two tabs can sign in side by side.
    const existing = readCookie(req, COOKIE_NAME);
    const binding = /^[\w-]{43}$/.test(existing ?? '') ? existing : randomToken();
    pending.set(state, {
      binding,
      nonce,
      verifier,
      requestClaims,
      expiresAt: clock().getTime() + PENDING_LIFETIME_MS,
    });

    const authorize = new URL(`${authority}/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(requestClaims.email ? { login_hint: requestClaims.email } : {}),
    }).toString();

    res.writeHead(302, {
      Location: authorize.href,
      'Set-Cookie': `${COOKIE_NAME}=${binding}; Path=${basePath}/; Max-Age=${PENDING_LIFETIME_MS / 1000}; HttpOnly; SameSite=Lax${secureCookie}`,
    });
    res.end();
  }

  async function redeemCode(code, verifier) {
    const response = await fetch(`${authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok || !body.id_token) {
      throw new BridgeError(`token endpoint failed: ${body.error ?? response.status}`);
    }
    return body.id_token;
  }

  async function verifiedIdentity(idToken, nonce) {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      currentDate: clock(),
    });
    if (payload.nonce !== nonce) throw new BridgeError('id token nonce mismatch');
    if (payload.tid !== tenantId) throw new BridgeError('id token is from another tenant');
    const identity = payload[identityClaim];
    if (typeof identity !== 'string' || !identity.includes('@')) {
      throw new BridgeError(`id token has no usable ${identityClaim} claim`);
    }
    return identity.toLowerCase();
  }

  async function finishSignIn(req, res, url) {
    const state = url.searchParams.get('state') ?? '';
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || entry.expiresAt <= clock().getTime()) {
      throw new BridgeError('unknown or expired state');
    }
    if (readCookie(req, COOKIE_NAME) !== entry.binding) {
      throw new BridgeError('state does not belong to this browser');
    }
    const microsoftError = url.searchParams.get('error');
    if (microsoftError) {
      throw new BridgeError(`microsoft returned ${microsoftError}: ${url.searchParams.get('error_description') ?? ''}`);
    }

    const idToken = await redeemCode(url.searchParams.get('code') ?? '', entry.verifier);
    const identity = await verifiedIdentity(idToken, entry.nonce);
    const token = await buildSignInToken(identity, entry.requestClaims, privateKey, clock());

    // The destination comes from configuration: only the checked path is taken from the token.
    const target = new URL(entry.requestClaims.path, leihsBaseUrl);
    target.searchParams.set('token', token);
    log('sign_in', { identity });
    res.writeHead(302, { Location: target.href });
    res.end();
  }

  async function handle(req, res) {
    // The leihs Apache config caches "/" on disk: nothing here may be cached.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, publicUrl);
    try {
      if (req.method !== 'GET') {
        res.writeHead(405).end();
      } else if (url.pathname === `${basePath}/health`) {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      } else if (url.pathname === `${basePath}/sign-in`) {
        await startSignIn(req, res, url);
      } else if (url.pathname === `${basePath}/callback`) {
        await finishSignIn(req, res, url);
      } else {
        res.writeHead(404).end();
      }
    } catch (error) {
      log('sign_in_failed', { reason: error.code ?? error.message });
      errorPage(res, error instanceof BridgeError ? 400 : 502, leihsBaseUrl);
    }
  }

  return createServer(handle);
}
