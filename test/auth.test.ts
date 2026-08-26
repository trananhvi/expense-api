import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { CredentialStore, SessionStore } from '../src/store.ts';

let server: Server;
let base: string;
let sessionStore: SessionStore;

beforeAll(async () => {
  const created = createApp();
  sessionStore = created.sessionStore;
  server = await new Promise<Server>((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  sessionStore.clear();
});

/** `fetch().json()` is `unknown` under strict TS; name the shape at the call site. */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function login(body: unknown): Promise<Response> {
  return fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getSession(authorization?: string): Promise<Response> {
  return fetch(`${base}/auth/session`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

function logout(authorization?: string): Promise<Response> {
  return fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('POST /auth/login', () => {
  it('returns 200 with a token and username, and no password, on correct credentials', async () => {
    const res = await login({ username: 'demo', password: 'demo-password' });
    expect(res.status).toBe(200);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body.username).toBe('demo');
    expect(typeof body.token).toBe('string');
    expect(body).not.toHaveProperty('password');
    expect(JSON.stringify(body)).not.toContain('demo-password');
  });

  it('authenticates a username differing only in case or surrounding whitespace', async () => {
    const res = await login({ username: '  DEMO  ', password: 'demo-password' });
    expect(res.status).toBe(200);
    const body = await readJson<{ username: string }>(res);
    expect(body.username).toBe('demo');
  });

  it('returns a different token on each successful login, both valid', async () => {
    const first = await readJson<{ token: string; username: string }>(
      await login({ username: 'demo', password: 'demo-password' }),
    );
    const second = await readJson<{ token: string; username: string }>(
      await login({ username: 'demo', password: 'demo-password' }),
    );

    expect(first.token).not.toBe(second.token);

    const firstSession = await getSession(`Bearer ${first.token}`);
    const secondSession = await getSession(`Bearer ${second.token}`);
    expect(firstSession.status).toBe(200);
    expect(secondSession.status).toBe(200);
    expect((await readJson<{ username: string }>(firstSession)).username).toBe('demo');
    expect((await readJson<{ username: string }>(secondSession)).username).toBe('demo');
  });

  it('rejects a wrong password and an unknown username identically', async () => {
    const wrongPassword = await login({ username: 'demo', password: 'nope' });
    const unknownUser = await login({ username: 'nobody', password: 'demo-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.status).toBe(wrongPassword.status);

    const wrongPasswordBody = await readJson(wrongPassword);
    const unknownUserBody = await readJson(unknownUser);
    expect(wrongPasswordBody).toEqual({ error: 'invalid credentials' });
    expect(unknownUserBody).toEqual(wrongPasswordBody);
  });

  it('never trims or lowercases the password', async () => {
    const res = await login({ username: 'demo', password: 'Demo-Password' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with error and details when password is missing', async () => {
    const res = await login({ username: 'demo' });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });

  it('returns 400 when username is blank', async () => {
    const res = await login({ username: '   ', password: 'demo-password' });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });

  it('returns 400, not 401, when password is a number', async () => {
    const res = await login({ username: 'demo', password: 12345 });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });

  it('returns 400 for a missing body', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when username is missing entirely', async () => {
    const res = await login({ password: 'demo-password' });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });

  it('returns 400, not 401, when username is a number', async () => {
    const res = await login({ username: 12345, password: 'demo-password' });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });
});

describe('GET /auth/login', () => {
  it('falls through to the generic 404 handler', async () => {
    const res = await fetch(`${base}/auth/login`);
    expect(res.status).toBe(404);
    const body = await readJson<{ error: string }>(res);
    expect(body).toEqual({ error: 'not found' });
  });
});

describe('GET /auth/session', () => {
  it('returns 200 with the username for a token issued by a successful login', async () => {
    const { token } = await readJson<{ token: string }>(await login({ username: 'demo', password: 'demo-password' }));

    const res = await getSession(`Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = await readJson<{ username: string }>(res);
    expect(body.username).toBe('demo');
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await getSession();
    expect(res.status).toBe(401);
    const body = await readJson<{ error: string }>(res);
    expect(body.error).toBeDefined();
  });

  it('returns 401, not 500, for a header missing the Bearer prefix', async () => {
    const res = await getSession('not-a-real-token');
    expect(res.status).toBe(401);
    const body = await readJson<{ error: string }>(res);
    expect(body.error).toBeDefined();
  });

  it('returns 401 for an empty Authorization header', async () => {
    const res = await getSession('');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a well-formed but unknown bearer token', async () => {
    const res = await getSession('Bearer 00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
    const body = await readJson<{ error: string }>(res);
    expect(body.error).toBeDefined();
  });
});

describe('POST /auth/logout', () => {
  it('returns 204 for a valid token, after which that token is rejected', async () => {
    const { token } = await readJson<{ token: string }>(await login({ username: 'demo', password: 'demo-password' }));

    const res = await logout(`Bearer ${token}`);
    expect(res.status).toBe(204);

    const session = await getSession(`Bearer ${token}`);
    expect(session.status).toBe(401);
  });

  it('leaves another token for the same user working after logging one out', async () => {
    const first = await readJson<{ token: string }>(await login({ username: 'demo', password: 'demo-password' }));
    const second = await readJson<{ token: string }>(await login({ username: 'demo', password: 'demo-password' }));

    const res = await logout(`Bearer ${first.token}`);
    expect(res.status).toBe(204);

    expect((await getSession(`Bearer ${first.token}`)).status).toBe(401);
    const stillValid = await getSession(`Bearer ${second.token}`);
    expect(stillValid.status).toBe(200);
    expect((await readJson<{ username: string }>(stillValid)).username).toBe('demo');
  });

  it('returns 401 for an unknown token', async () => {
    const res = await logout('Bearer 00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
    const body = await readJson<{ error: string }>(res);
    expect(body.error).toBeDefined();
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await logout();
    expect(res.status).toBe(401);
  });
});

describe('CredentialStore (HTTP-free)', () => {
  it('is importable and callable without going through the HTTP layer', () => {
    const store = new CredentialStore({ username: 'demo', password: 'demo-password' });
    expect(store.verify('demo', 'demo-password')).toEqual({ username: 'demo' });
  });

  it('returns undefined for an unknown username without throwing', () => {
    const store = new CredentialStore({ username: 'demo', password: 'demo-password' });
    expect(() => store.verify('nobody', 'whatever')).not.toThrow();
    expect(store.verify('nobody', 'whatever')).toBeUndefined();
  });
});

describe('SessionStore (HTTP-free)', () => {
  it('issues and revokes a token', () => {
    const store = new SessionStore();
    const token = store.issue('demo');
    expect(store.get(token)).toEqual({ username: 'demo' });

    expect(store.revoke(token)).toBe(true);
    expect(store.get(token)).toBeUndefined();
  });

  it('returns undefined for an unknown token without throwing', () => {
    const store = new SessionStore();
    expect(() => store.get('nope')).not.toThrow();
    expect(store.get('nope')).toBeUndefined();
  });

  it('clear() empties the store', () => {
    const store = new SessionStore();
    store.issue('demo');
    store.issue('someone-else');
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('createApp credentialStore wiring', () => {
  it('accepts an injected credentialStore in AppDeps, returns it, and uses it to authenticate', async () => {
    const injected = new CredentialStore({ username: 'injected-user', password: 'injected-pass' });
    const created = createApp({ credentialStore: injected });
    expect(created.credentialStore).toBe(injected);

    const server = await new Promise<Server>((resolve) => {
      const s = created.app.listen(0, () => resolve(s));
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'injected-user', password: 'injected-pass' }),
      });
      expect(res.status).toBe(200);
      const body = await readJson<{ username: string }>(res);
      expect(body.username).toBe('injected-user');

      const rejected = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo-password' }),
      });
      expect(rejected.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('falls back to AUTH_USERNAME / AUTH_PASSWORD env vars when no credentialStore is injected', async () => {
    const prevUsername = process.env.AUTH_USERNAME;
    const prevPassword = process.env.AUTH_PASSWORD;
    process.env.AUTH_USERNAME = 'env-user';
    process.env.AUTH_PASSWORD = 'env-pass';

    let server: Server | undefined;
    try {
      const created = createApp();
      server = await new Promise<Server>((resolve) => {
        const s = created.app.listen(0, () => resolve(s));
      });
      const { port } = server.address() as AddressInfo;

      const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'env-user', password: 'env-pass' }),
      });
      expect(res.status).toBe(200);

      const defaultCredsRejected = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo-password' }),
      });
      expect(defaultCredsRejected.status).toBe(401);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (prevUsername === undefined) delete process.env.AUTH_USERNAME;
      else process.env.AUTH_USERNAME = prevUsername;
      if (prevPassword === undefined) delete process.env.AUTH_PASSWORD;
      else process.env.AUTH_PASSWORD = prevPassword;
    }
  });
});

describe('createApp sessionStore wiring', () => {
  it('accepts an injected sessionStore in AppDeps, returns it, and uses it for sessions', async () => {
    const injected = new SessionStore();
    const created = createApp({ sessionStore: injected });
    expect(created.sessionStore).toBe(injected);

    const server = await new Promise<Server>((resolve) => {
      const s = created.app.listen(0, () => resolve(s));
    });
    try {
      const { port } = server.address() as AddressInfo;
      const loginRes = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo-password' }),
      });
      const { token } = await readJson<{ token: string }>(loginRes);
      expect(injected.size).toBe(1);
      expect(injected.get(token)).toEqual({ username: 'demo' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
