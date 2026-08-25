import { z } from 'zod';

/** ISO-8601 calendar date, e.g. "2026-08-25". Compared as a string throughout. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO-8601 date (YYYY-MM-DD)')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a real calendar date');

export const NewExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  /** Integer cents. Never a float — see CONVENTIONS.md rule 3. */
  amountCents: z.number().int().positive(),
  category: z.string().trim().min(1).max(50),
  spentOn: IsoDate,
});

export type NewExpense = z.infer<typeof NewExpenseSchema>;

export interface Expense extends NewExpense {
  id: string;
  createdAt: string;
}

export const ExpenseQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

export type ExpenseQuery = z.infer<typeof ExpenseQuerySchema>;

export const NewLimitSchema = z.object({
  /** Integer cents. Never a float — see CONVENTIONS.md rule 3. */
  amountCents: z.number().int().positive(),
});

export type NewLimit = z.infer<typeof NewLimitSchema>;

export interface SpendingLimit extends NewLimit {
  category: string;
}
