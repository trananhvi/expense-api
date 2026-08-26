import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { ExpenseStore, LimitStore } from '../src/store.ts';
import type { SpendingLimit } from '../src/types.ts';

let server: Server;
let limitStore: LimitStore;
let expenseStore: ExpenseStore;
let base: string;

beforeAll(async () => {
  const created = createApp();
  limitStore = created.limitStore;
  expenseStore = created.store;
  server = await new Promise<Server>((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  limitStore.clear();
  expenseStore.clear();
});

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

function getUsage(query?: string): Promise<Response> {
  return fetch(`${base}/limits/usage${query ? `?${query}` : ''}`);
}

function postExpense(body: unknown): Promise<Response> {
  return fetch(`${base}/expenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteExpense(id: string): Promise<Response> {
  return fetch(`${base}/expenses/${id}`, { method: 'DELETE' });
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

  it('matches an expense stored under the lowercased category', async () => {
    await putLimit('FOOD', { amountCents: 50000 });
    const expense = expenseStore.create({
      description: 'lunch',
      amountCents: 1200,
      category: 'Food',
      spentOn: '2026-08-20',
    });

    expect(expense.category).toBe('food');
    expect(limitStore.get(expense.category)).toEqual({ category: 'food', amountCents: 50000 });
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

  it('deletes regardless of the case used', async () => {
    await putLimit('food', { amountCents: 50000 });

    expect((await deleteLimit('FOOD')).status).toBe(204);
    expect(limitStore.size).toBe(0);
  });

  it('404s for a category that was never set', async () => {
    const res = await deleteLimit('nonexistent');
    expect(res.status).toBe(404);
    const body = await readJson<{ error: string }>(res);
    expect(body.error).toBeDefined();
  });
});

interface Usage {
  category: string;
  limitCents: number;
  spentCents: number;
  remainingCents: number;
  overBy: number;
}

describe('GET /limits/usage', () => {
  it('sums matching expenses for the given month', async () => {
    await putLimit('food', { amountCents: 50000 });
    await postExpense({ description: 'lunch', amountCents: 4250, category: 'food', spentOn: '2026-08-01' });
    await postExpense({ description: 'dinner', amountCents: 3100, category: 'food', spentOn: '2026-08-15' });

    const res = await getUsage('month=2026-08');
    expect(res.status).toBe(200);
    const body = await readJson<{ month: string; usage: Usage[] }>(res);
    expect(body.month).toBe('2026-08');
    expect(body.usage).toEqual([
      { category: 'food', limitCents: 50000, spentCents: 7350, remainingCents: 42650, overBy: 0 },
    ]);
  });

  it('excludes expenses from a different month', async () => {
    await putLimit('food', { amountCents: 50000 });
    await postExpense({ description: 'lunch', amountCents: 4250, category: 'food', spentOn: '2026-07-01' });

    const { usage } = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(usage).toEqual([{ category: 'food', limitCents: 50000, spentCents: 0, remainingCents: 50000, overBy: 0 }]);
  });

  it('includes a limit with no expenses at spentCents 0', async () => {
    await putLimit('travel', { amountCents: 20000 });

    const { usage } = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(usage).toEqual([
      { category: 'travel', limitCents: 20000, spentCents: 0, remainingCents: 20000, overBy: 0 },
    ]);
  });

  it('ignores expenses in a category with no configured limit', async () => {
    await postExpense({ description: 'lunch', amountCents: 4250, category: 'food', spentOn: '2026-08-01' });

    const { usage } = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(usage).toEqual([]);
  });

  it('caps remainingCents at 0 and reports the excess as overBy when over budget', async () => {
    await putLimit('food', { amountCents: 5000 });
    await postExpense({ description: 'feast', amountCents: 8000, category: 'food', spentOn: '2026-08-01' });

    const { usage } = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(usage).toEqual([{ category: 'food', limitCents: 5000, spentCents: 8000, remainingCents: 0, overBy: 3000 }]);
  });

  it('reflects a deleted expense on the next request', async () => {
    await putLimit('food', { amountCents: 50000 });
    const created = await readJson<{ id: string }>(
      await postExpense({ description: 'lunch', amountCents: 4250, category: 'food', spentOn: '2026-08-01' }),
    );

    const before = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(before.usage).toHaveLength(1);
    expect(before.usage[0]?.spentCents).toBe(4250);

    expect((await deleteExpense(created.id)).status).toBe(204);

    const after = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(after.usage).toHaveLength(1);
    expect(after.usage[0]?.spentCents).toBe(0);
  });

  it('rejects a malformed month', async () => {
    const res = await getUsage('month=August');
    expect(res.status).toBe(400);
    const body = await readJson<{ error: string; details: unknown }>(res);
    expect(body.error).toBeDefined();
    expect(body.details).toBeDefined();
  });

  it('matches categories case-insensitively end to end', async () => {
    await putLimit('FOOD', { amountCents: 50000 });
    await postExpense({ description: 'lunch', amountCents: 1200, category: 'Food', spentOn: '2026-08-01' });

    const { usage } = await readJson<{ usage: Usage[] }>(await getUsage('month=2026-08'));
    expect(usage).toEqual([{ category: 'food', limitCents: 50000, spentCents: 1200, remainingCents: 48800, overBy: 0 }]);
  });

  it('defaults to the current calendar month when omitted', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const res = await getUsage();
    expect(res.status).toBe(200);
    const body = await readJson<{ month: string }>(res);
    expect(body.month).toBe(currentMonth);
  });
});
