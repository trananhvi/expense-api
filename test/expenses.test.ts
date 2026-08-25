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

describe('GET /expenses/export.csv', () => {
  it('returns just the header row when there are no expenses', async () => {
    const res = await fetch(`${base}/expenses/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    await expect(res.text()).resolves.toBe('id,description,amountCents,category,spentOn,createdAt\n');
  });

  it('is not intercepted by GET /expenses/:id', async () => {
    const res = await fetch(`${base}/expenses/export.csv`);
    await expect(res.text()).resolves.not.toContain('expense not found');
  });

  it('exports expenses newest spend first, with amountCents unquoted', async () => {
    const lunch = await createExpense(LUNCH);
    const taxi = await createExpense(TAXI);

    const res = await fetch(`${base}/expenses/export.csv`);
    const text = await res.text();
    const [header, ...lines] = text.split('\n').filter(Boolean);

    expect(header).toBe('id,description,amountCents,category,spentOn,createdAt');
    expect(lines).toEqual([
      `${taxi.id},Airport taxi,3100,travel,2026-08-14,${taxi.createdAt}`,
      `${lunch.id},Team lunch,4250,food,2026-08-01,${lunch.createdAt}`,
    ]);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('filters by category, case-insensitively', async () => {
    await createExpense(LUNCH);
    await createExpense(TAXI);

    const text = await (await fetch(`${base}/expenses/export.csv?category=FOOD`)).text();
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Team lunch');
  });

  it('filters by date range inclusively', async () => {
    await createExpense(LUNCH);
    await createExpense(TAXI);

    const text = await (await fetch(`${base}/expenses/export.csv?from=2026-08-01&to=2026-08-01`)).text();
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2026-08-01');
  });

  it('rejects a malformed date filter', async () => {
    const res = await fetch(`${base}/expenses/export.csv?from=yesterday`);
    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({ error: 'invalid query' });
  });

  it('rejects a malformed "to" date filter', async () => {
    const res = await fetch(`${base}/expenses/export.csv?to=not-a-date`);
    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({ error: 'invalid query' });
    expect(res.headers.get('content-type')).not.toMatch(/^text\/csv/);
  });

  it('rejects an empty category filter', async () => {
    const res = await fetch(`${base}/expenses/export.csv?category=`);
    expect(res.status).toBe(400);
    await expect(readJson(res)).resolves.toMatchObject({ error: 'invalid query' });
  });

  it('breaks ties on equal spentOn by newest createdAt first', async () => {
    const first = await createExpense({ ...LUNCH, spentOn: '2026-08-01' });
    // createdAt has millisecond resolution; force it to differ from `first`.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createExpense({ ...TAXI, spentOn: '2026-08-01' });
    expect(second.createdAt > first.createdAt).toBe(true);

    const res = await fetch(`${base}/expenses/export.csv`);
    const lines = (await res.text()).split('\n').filter(Boolean);

    expect(lines).toEqual([
      'id,description,amountCents,category,spentOn,createdAt',
      `${second.id},Airport taxi,3100,travel,2026-08-01,${second.createdAt}`,
      `${first.id},Team lunch,4250,food,2026-08-01,${first.createdAt}`,
    ]);
  });

  it('quotes a field containing only a comma', async () => {
    const created = await createExpense({ ...LUNCH, description: 'Coffee, tea' });

    const text = await (await fetch(`${base}/expenses/export.csv`)).text();
    const dataLine = text.split('\n')[1];

    expect(dataLine).toContain('"Coffee, tea"');
    expect(dataLine).toBe(
      `${created.id},"Coffee, tea",4250,food,2026-08-01,${created.createdAt}`,
    );
  });

  it('quotes and doubles a field containing only a double quote', async () => {
    const created = await createExpense({ ...LUNCH, description: 'The "usual" order' });

    const text = await (await fetch(`${base}/expenses/export.csv`)).text();
    const dataLine = text.split('\n')[1];

    expect(dataLine).toBe(
      `${created.id},"The ""usual"" order",4250,food,2026-08-01,${created.createdAt}`,
    );
  });

  it('quotes a field containing only a newline, and the row round-trips to one record', async () => {
    const created = await createExpense({ ...LUNCH, description: 'Team lunch\nwith clients' });

    const res = await fetch(`${base}/expenses/export.csv`);
    const body = await res.text();
    const dataLine = body.split('\n').slice(1).join('\n').trimEnd();

    expect(dataLine).toBe(
      `${created.id},"Team lunch\nwith clients",4250,food,2026-08-01,${created.createdAt}`,
    );

    const match = dataLine.match(/^[^,]+,"((?:[^"]|"")*)",/s);
    expect(match?.[1]?.replace(/""/g, '"')).toBe('Team lunch\nwith clients');
  });

  it('quotes and escapes fields containing a comma, quote, or newline', async () => {
    const created = await createExpense({
      description: 'Client dinner, "fancy" place\nwith wine',
      amountCents: 9999,
      category: 'food',
      spentOn: '2026-08-20',
    });

    const res = await fetch(`${base}/expenses/export.csv`);
    const body = await res.text();
    const dataLine = body.split('\n').slice(1).join('\n').trimEnd();

    expect(dataLine).toContain('"Client dinner, ""fancy"" place\nwith wine"');

    // A standard CSV parse should recover the original description.
    const match = dataLine.match(/^[^,]+,"((?:[^"]|"")*)",/s);
    expect(match?.[1]?.replace(/""/g, '"')).toBe('Client dinner, "fancy" place\nwith wine');
    expect(created.description).toBe('Client dinner, "fancy" place\nwith wine');
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
