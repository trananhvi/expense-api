import { Router } from 'express';
import type { LimitStore } from '../store.ts';
import { NewLimitSchema } from '../types.ts';

export function limitsRouter(store: LimitStore): Router {
  const router = Router();

  router.put('/:category', (req, res) => {
    const category = req.params.category.trim();
    if (!category) {
      return res.status(400).json({ error: 'category must not be empty' });
    }

    const parsed = NewLimitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid limit', details: parsed.error.issues });
    }

    return res.status(200).json(store.set(category, parsed.data.amountCents));
  });

  router.get('/', (_req, res) => {
    const limits = store.list().sort((a, b) => a.category.localeCompare(b.category));
    return res.json({ limits });
  });

  router.delete('/:category', (req, res) => {
    if (!store.delete(req.params.category)) {
      return res.status(404).json({ error: 'limit not found' });
    }
    return res.status(204).end();
  });

  return router;
}
