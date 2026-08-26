import express, { type Express } from 'express';
import { CredentialStore, ExpenseStore, LimitStore, SessionStore } from './store.ts';
import { expensesRouter } from './routes/expenses.ts';
import { limitsRouter } from './routes/limits.ts';
import { authRouter } from './routes/auth.ts';

export interface AppDeps {
  store?: ExpenseStore;
  limitStore?: LimitStore;
  credentialStore?: CredentialStore;
  sessionStore?: SessionStore;
}

/**
 * Builds the app. Never listens on a port — `src/server.ts` does that, and
 * tests bind their own ephemeral port.
 */
export function createApp({
  store = new ExpenseStore(),
  limitStore = new LimitStore(),
  credentialStore = new CredentialStore({
    username: process.env.AUTH_USERNAME ?? 'demo',
    password: process.env.AUTH_PASSWORD ?? 'demo-password',
  }),
  sessionStore = new SessionStore(),
}: AppDeps = {}): {
  app: Express;
  store: ExpenseStore;
  limitStore: LimitStore;
  credentialStore: CredentialStore;
  sessionStore: SessionStore;
} {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/expenses', expensesRouter(store, limitStore));
  app.use('/limits', limitsRouter(limitStore, store));
  app.use('/auth', authRouter(credentialStore, sessionStore));

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  return { app, store, limitStore, credentialStore, sessionStore };
}
