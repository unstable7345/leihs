const API_TIMEOUT_MS = 10_000;

function namesFrom(claims) {
  const [first, ...rest] = (claims.name ?? '').trim().split(/\s+/);
  return {
    firstname: claims.given_name || first || null,
    lastname: claims.family_name || rest.join(' ') || null,
  };
}

/**
 * Creates leihs accounts on first sign-in, through the leihs admin API. The
 * token's owner must be an admin, with the admin read and write scopes.
 */
export function createAccounts({ apiUrl, apiToken, emailDomains }) {
  async function request(method, path, body) {
    const response = await fetch(new URL(path, apiUrl), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Token ${apiToken}`,
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    return response;
  }

  async function findUser(email) {
    const query = new URLSearchParams({ term: email });
    const response = await request('GET', `/admin/users/?${query}`);
    if (!response.ok) throw new Error(`user search failed with status ${response.status}`);
    const { users } = await response.json();
    // The search also matches secondary emails, which belong to someone else's account.
    return users.find((user) => user.email?.toLowerCase() === email);
  }

  async function createUser(email, claims) {
    const response = await request('POST', '/admin/users/', {
      email,
      ...namesFrom(claims),
      password_sign_in_enabled: false,
    });
    if (response.status === 201) return response.json();
    // Two simultaneous first sign-ins: the other one has just created the account.
    const existing = await findUser(email);
    if (existing) return existing;
    throw new Error(`user creation failed with status ${response.status}`);
  }

  async function linkUser(authSystemId, userId) {
    const response = await request(
      'PUT',
      `/admin/system/authentication-systems/${encodeURIComponent(authSystemId)}/users/${encodeURIComponent(userId)}`,
      {},
    );
    if (!response.ok) throw new Error(`user link failed with status ${response.status}`);
  }

  return {
    /** Returns false when the address is outside the allowed domains. */
    async ensure(email, claims, authSystemId) {
      if (!emailDomains.includes(email.split('@').pop())) return false;
      const user = (await findUser(email)) ?? (await createUser(email, claims));
      await linkUser(authSystemId, user.id);
      return true;
    },
  };
}
