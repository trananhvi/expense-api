import express, { type Express } from 'express';
import { ExpenseStore } from './store.ts';
import { expensesRouter } from './routes/expenses.ts';

export interface AppDeps {
  store?: ExpenseStore;
}

/**
 * Builds the app. Never listens on a port — `src/server.ts` does that, and
 * tests bind their own ephemeral port.
 */
export function createApp({ store = new ExpenseStore() }: AppDeps = {}): {
  app: Express;
  store: ExpenseStore;
} {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/expenses', expensesRouter(store));

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  return { app, store };
}
