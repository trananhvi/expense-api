import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { CredentialStore } from '../src/store.ts';

let server: Server;
let base: string;

beforeAll(async () => {
  const created = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

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

describe('POST /auth/login', () => {
  it('returns 200 with the username and no password on correct credentials', async () => {
    const res = await login({ username: 'demo', password: 'demo-password' });
    expect(res.status).toBe(200);

    const body = await readJson<Record<string, unknown>>(res);
    expect(body.username).toBe('demo');
    expect(body).not.toHaveProperty('password');
    expect(JSON.stringify(body)).not.toContain('demo-password');
  });

  it('authenticates a username differing only in case or surrounding whitespace', async () => {
    const res = await login({ username: '  DEMO  ', password: 'demo-password' });
    expect(res.status).toBe(200);
    const body = await readJson<{ username: string }>(res);
    expect(body.username).toBe('demo');
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
