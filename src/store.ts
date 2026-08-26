import { randomUUID } from 'node:crypto';
import type { CategoryUsage, Expense, ExpenseQuery, NewExpense, SpendingLimit } from './types.ts';

export interface Credential {
  username: string;
  password: string;
}

/**
 * In-memory expense storage.
 *
 * Pure and synchronous: no HTTP types cross this boundary, and nothing here
 * throws for a missing record — callers get `undefined` and decide what that
 * means (CONVENTIONS.md rule 2).
 */
export class ExpenseStore {
  readonly #byId = new Map<string, Expense>();

  create(input: NewExpense): Expense {
    const expense: Expense = {
      ...input,
      category: input.category.toLowerCase(),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.#byId.set(expense.id, expense);
    return expense;
  }

  get(id: string): Expense | undefined {
    return this.#byId.get(id);
  }

  delete(id: string): boolean {
    return this.#byId.delete(id);
  }

  /** Newest spend first, then newest created first, so ordering is stable. */
  list(query: ExpenseQuery = {}): Expense[] {
    const category = query.category?.toLowerCase();
    return [...this.#byId.values()]
      .filter((e) => (category ? e.category === category : true))
      .filter((e) => (query.from ? e.spentOn >= query.from : true))
      .filter((e) => (query.to ? e.spentOn <= query.to : true))
      .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAt.localeCompare(a.createdAt));
  }

  clear(): void {
    this.#byId.clear();
  }

  get size(): number {
    return this.#byId.size;
  }
}

/**
 * In-memory spending limit storage.
 *
 * Pure and synchronous, mirroring `ExpenseStore`'s shape: nothing here throws
 * for a missing record — callers get `undefined` or `false` and decide what
 * that means (CONVENTIONS.md rule 2).
 */
export class LimitStore {
  readonly #byCategory = new Map<string, SpendingLimit>();

  set(category: string, amountCents: number): SpendingLimit {
    const limit: SpendingLimit = { category: category.toLowerCase(), amountCents };
    this.#byCategory.set(limit.category, limit);
    return limit;
  }

  get(category: string): SpendingLimit | undefined {
    return this.#byCategory.get(category.toLowerCase());
  }

  delete(category: string): boolean {
    return this.#byCategory.delete(category.toLowerCase());
  }

  list(): SpendingLimit[] {
    return [...this.#byCategory.values()];
  }

  clear(): void {
    this.#byCategory.clear();
  }

  get size(): number {
    return this.#byCategory.size;
  }
}

/**
 * In-memory credential storage, seeded with a single predefined credential.
 *
 * Pure and synchronous, mirroring the other stores: nothing here throws for
 * an unknown username — callers get `undefined` (CONVENTIONS.md rule 2).
 * Usernames are matched case-insensitively and trimmed, like categories;
 * passwords are matched exactly.
 */
export class CredentialStore {
  readonly #byUsername = new Map<string, Credential>();

  constructor(credential: Credential) {
    this.#byUsername.set(credential.username.trim().toLowerCase(), credential);
  }

  verify(username: string, password: string): { username: string } | undefined {
    const credential = this.#byUsername.get(username.trim().toLowerCase());
    if (!credential || credential.password !== password) {
      return undefined;
    }
    return { username: credential.username };
  }
}

/**
 * In-memory session storage, mapping opaque tokens to usernames.
 *
 * Pure and synchronous, mirroring the other stores: nothing here throws for
 * an unknown token — callers get `undefined` (CONVENTIONS.md rule 2). Nothing
 * is persisted, so restarting the process clears every session.
 */
export class SessionStore {
  readonly #byToken = new Map<string, { username: string }>();

  issue(username: string): string {
    const token = randomUUID();
    this.#byToken.set(token, { username });
    return token;
  }

  get(token: string): { username: string } | undefined {
    return this.#byToken.get(token);
  }

  revoke(token: string): boolean {
    return this.#byToken.delete(token);
  }

  clear(): void {
    this.#byToken.clear();
  }

  get size(): number {
    return this.#byToken.size;
  }
}

/**
 * Month-to-date usage per configured limit, derived on the fly from the
 * expense store rather than kept as a running counter — deleting an expense
 * frees up budget with no extra bookkeeping. HTTP-free (CONVENTIONS.md).
 */
export function computeUsage(expenseStore: ExpenseStore, limitStore: LimitStore, month: string): CategoryUsage[] {
  const spentByCategory = new Map<string, number>();
  for (const expense of expenseStore.list()) {
    if (expense.spentOn.slice(0, 7) !== month) continue;
    spentByCategory.set(expense.category, (spentByCategory.get(expense.category) ?? 0) + expense.amountCents);
  }

  return limitStore.list().map((limit) => {
    const spentCents = spentByCategory.get(limit.category) ?? 0;
    return {
      category: limit.category,
      limitCents: limit.amountCents,
      spentCents,
      remainingCents: Math.max(0, limit.amountCents - spentCents),
      overBy: Math.max(0, spentCents - limit.amountCents),
    };
  });
}
