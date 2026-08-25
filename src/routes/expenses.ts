import { Router } from 'express';
import type { ExpenseStore } from '../store.ts';
import { ExpenseQuerySchema, NewExpenseSchema } from '../types.ts';

const CSV_HEADER = 'id,description,amountCents,category,spentOn,createdAt';

/** Quotes and escapes a field per RFC 4180 if it contains a comma, quote, or newline. */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function expensesRouter(store: ExpenseStore): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const parsed = NewExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid expense', details: parsed.error.issues });
    }
    return res.status(201).json(store.create(parsed.data));
  });

  router.get('/', (req, res) => {
    const parsed = ExpenseQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid query', details: parsed.error.issues });
    }
    return res.json({ expenses: store.list(parsed.data) });
  });

  router.get('/export.csv', (req, res) => {
    const parsed = ExpenseQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid query', details: parsed.error.issues });
    }
    const rows = store.list(parsed.data).map((e) =>
      [e.id, e.description, String(e.amountCents), e.category, e.spentOn, e.createdAt].map(csvField).join(','),
    );
    const body = [CSV_HEADER, ...rows].map((line) => `${line}\n`).join('');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(body);
  });

  router.get('/:id', (req, res) => {
    const expense = store.get(req.params.id);
    if (!expense) return res.status(404).json({ error: 'expense not found' });
    return res.json(expense);
  });

  router.delete('/:id', (req, res) => {
    if (!store.delete(req.params.id)) {
      return res.status(404).json({ error: 'expense not found' });
    }
    return res.status(204).end();
  });

  return router;
}
