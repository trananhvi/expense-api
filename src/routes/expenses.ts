import { Router } from 'express';
import type { ExpenseStore } from '../store.ts';
import { ExpenseQuerySchema, NewExpenseSchema } from '../types.ts';

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
