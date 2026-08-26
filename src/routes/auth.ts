import { Router } from 'express';
import type { CredentialStore } from '../store.ts';
import { LoginSchema } from '../types.ts';

export function authRouter(store: CredentialStore): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid login', details: parsed.error.issues });
    }

    const credential = store.verify(parsed.data.username, parsed.data.password);
    if (!credential) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    return res.status(200).json(credential);
  });

  return router;
}
