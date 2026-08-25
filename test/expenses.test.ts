import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { ExpenseStore } from '../src/store.ts';
import type { Expense } from '../src/types.ts';

let server: Server;
let store: ExpenseStore;
let base: string;

beforeAll(async () => {
  const created = createApp();
  store = created.store;
  server = await new Promise<Server>((resolve) => {
    const s = created.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => store.clear());

/** `fetch().json()` is `unknown` under strict TS; name the shape at the call site. */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function post(body: unknown): Promise<Response> {
  return fetch(`${base}/expenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createExpense(body: unknown): Promise<Expense> {
  return readJson<Expense>(await post(body));
}

function listExpenses(query = ''): Promise<Response> {
  return fetch(`${base}/expenses${query}`);
}

const LUNCH = { description: 'Team lunch', amountCents: 4250, category: 'Food', spentOn: '2026-08-01' };
const TAXI = { description: 'Airport taxi', amountCents: 3100, category: 'travel', spentOn: '2026-08-14' };

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({ ok: true });
  });
});

describe('POST /expenses', () => {
  it('creates an expense and lowercases the category', async () => {
    const res = await post(LUNCH);
    expect(res.status).toBe(201);

    const body = await readJson<Expense>(res);
    expect(body).toMatchObject({ description: 'Team lunch', amountCents: 4250, category: 'food' });
    expect(body.id).toBeTypeOf('string');
    expect(body.createdAt).toBeTypeOf('string');
  });

  it('rejects a fractional amount', async () => {
    const res = await post({ ...LUNCH, amountCents: 42.5 });
    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({ error: 'invalid expense' });
  });

  it('rejects a malformed date', async () => {
    const res = await post({ ...LUNCH, spentOn: '01/08/2026' });
    expect(res.status).toBe(400);
  });
});

describe('GET /expenses', () => {
  beforeEach(async () => {
    await post(LUNCH);
    await post(TAXI);
  });

  it('lists newest spend first', async () => {
    const { expenses } = await readJson<{ expenses: Expense[] }>(await listExpenses());
    expect(expenses.map((e) => e.spentOn)).toEqual(['2026-08-14', '2026-08-01']);
  });

  it('filters by category, case-insensitively', async () => {
    const { expenses } = await readJson<{ expenses: Expense[] }>(await listExpenses('?category=FOOD'));
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.description).toBe('Team lunch');
  });

  it('filters by date range inclusively', async () => {
    const res = await listExpenses('?from=2026-08-01&to=2026-08-01');
    const { expenses } = await readJson<{ expenses: Expense[] }>(res);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.spentOn).toBe('2026-08-01');
  });

  it('rejects a malformed date filter', async () => {
    expect((await listExpenses('?from=yesterday')).status).toBe(400);
  });
});

describe('GET /expenses/summary', () => {
  const DINNER = { description: 'Dinner', amountCents: 1000, category: 'food', spentOn: '2026-08-20' };

  function summary(query = ''): Promise<Response> {
    return fetch(`${base}/expenses/summary${query}`);
  }

  it('returns an empty totals array when there are no expenses', async () => {
    const res = await summary();
    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toEqual({ totals: [] });
  });

  it('aggregates totals by category, sorted by totalCents descending', async () => {
    await post(LUNCH);
    await post(TAXI);
    await post(DINNER);

    const { totals } = await readJson<{ totals: { category: string; totalCents: number; count: number }[] }>(
      await summary(),
    );

    expect(totals).toEqual([
      { category: 'food', totalCents: 5250, count: 2 },
      { category: 'travel', totalCents: 3100, count: 1 },
    ]);
  });

  it('filters by date range inclusively', async () => {
    await post(LUNCH);
    await post(TAXI);

    const res = await summary('?from=2026-08-14&to=2026-08-14');
    const { totals } = await readJson<{ totals: { category: string; totalCents: number; count: number }[] }>(res);
    expect(totals).toEqual([{ category: 'travel', totalCents: 3100, count: 1 }]);
  });

  it('rejects a malformed date filter', async () => {
    expect((await summary('?from=yesterday')).status).toBe(400);
  });
});

describe('GET /expenses/:id', () => {
  it('returns the expense', async () => {
    const created = await createExpense(LUNCH);
    const res = await fetch(`${base}/expenses/${created.id}`);
    expect(res.status).toBe(200);
    await expect(readJson(res)).resolves.toMatchObject({ id: created.id });
  });

  it('404s for an unknown id', async () => {
    expect((await fetch(`${base}/expenses/does-not-exist`)).status).toBe(404);
  });
});

describe('DELETE /expenses/:id', () => {
  it('deletes, then 404s on the second attempt', async () => {
    const created = await createExpense(LUNCH);

    expect((await fetch(`${base}/expenses/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/expenses/${created.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(store.size).toBe(0);
  });
});
