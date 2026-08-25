import { randomUUID } from 'node:crypto';
import type { CategoryTotal, Expense, ExpenseQuery, ExpenseSummaryQuery, NewExpense } from './types.ts';

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

  /** Totals per category for the given date range, sorted by totalCents descending. */
  summary(query: ExpenseSummaryQuery = {}): CategoryTotal[] {
    const totals = new Map<string, { totalCents: number; count: number }>();
    for (const expense of this.list(query)) {
      const entry = totals.get(expense.category) ?? { totalCents: 0, count: 0 };
      entry.totalCents += expense.amountCents;
      entry.count += 1;
      totals.set(expense.category, entry);
    }
    return [...totals.entries()]
      .map(([category, { totalCents, count }]) => ({ category, totalCents, count }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }

  clear(): void {
    this.#byId.clear();
  }

  get size(): number {
    return this.#byId.size;
  }
}
