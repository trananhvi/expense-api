import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { LimitStore } from '../src/store.ts';
import type { SpendingLimit } from '../src/types.ts';

let server: Server;
let limitStore: LimitStore;
let base: string;

beforeAll(async () => {
  const created = createApp();
  limitStore = created.limitStore;
  server = await new Promise<Server>((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => limitStore.clear());

/** `fetch().json()` is `unknown` under strict TS; name the shape at the call site. */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function putLimit(category: string, body: unknown): Promise<Response> {
  return fetch(`${base}/limits/${category}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getLimits(): Promise<Response> {
  return fetch(`${base}/limits`);
}

function deleteLimit(category: string): Promise<Response> {
  return fetch(`${base}/limits/${category}`, { method: 'DELETE' });
}

describe('PUT /limits/:category', () => {
  it('creates a limit and returns it', async () => {
    const res = await putLimit('food', { amountCents: 50000 });
    expect(res.status).toBe(200);

    const body = await readJson<SpendingLimit>(res);
    expect(body).toEqual({ category: 'food', amountCents: 50000 });
  });

  it('overwrites rather than duplicating on a second PUT', async () => {
    await putLimit('food', { amountCents: 50000 });
    await putLimit('food', { amountCents: 60000 });

    const { limits } = await readJson<{ limits: SpendingLimit[] }>(await getLimits());
    expect(limits).toHaveLength(1);
    expect(limits[0]).toEqual({ category: 'food', amountCents: 60000 });
  });

  it('lowercases the category', async () => {
    await putLimit('FOOD', { amountCents: 50000 });

    const { limits } = await readJson<{ limits: SpendingLimit[] }>(await getLimits());
    expect(limits).toEqual([{ category: 'food', amountCents: 50000 }]);
  });

  it('rejects a fractional amount', async () => {
    const res = await putLimit('food', { amountCents: 12.5 });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBe('invalid limit');
    expect(body.details).toBeDefined();
  });

  it('rejects a negative amount', async () => {
    const res = await putLimit('food', { amountCents: -1 });
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBe('invalid limit');
    expect(body.details).toBeDefined();
  });

  it('rejects an empty category', async () => {
    const res = await putLimit('%20', { amountCents: 50000 });
    expect(res.status).toBe(400);
    expect(limitStore.size).toBe(0);
  });
});

describe('GET /limits', () => {
  it('returns an empty list when nothing is set', async () => {
    await expect(readJson(await getLimits())).resolves.toEqual({ limits: [] });
  });

  it('sorts by category', async () => {
    await putLimit('travel', { amountCents: 20000 });
    await putLimit('food', { amountCents: 50000 });

    const { limits } = await readJson<{ limits: SpendingLimit[] }>(await getLimits());
    expect(limits.map((l) => l.category)).toEqual(['food', 'travel']);
  });
});

describe('DELETE /limits/:category', () => {
  it('deletes, then 404s on the second attempt', async () => {
    await putLimit('food', { amountCents: 50000 });

    expect((await deleteLimit('food')).status).toBe(204);
    expect((await deleteLimit('food')).status).toBe(404);
    expect(limitStore.size).toBe(0);
  });
});
