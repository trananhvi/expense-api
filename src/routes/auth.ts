import { Router } from 'express';
import type { CredentialStore, SessionStore } from '../store.ts';
import { LoginSchema } from '../types.ts';

const BEARER_PREFIX = 'Bearer ';

function tokenFromHeader(header: string | undefined): string | undefined {
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : undefined;
}

export function authRouter(store: CredentialStore, sessionStore: SessionStore): Router {
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

    const token = sessionStore.issue(credential.username);
    return res.status(200).json({ token, username: credential.username });
  });

  router.get('/session', (req, res) => {
    const token = tokenFromHeader(req.header('authorization'));
    if (!token) {
      return res.status(401).json({ error: 'missing or malformed bearer token' });
    }

    const session = sessionStore.get(token);
    if (!session) {
      return res.status(401).json({ error: 'invalid session' });
    }

    return res.status(200).json({ username: session.username });
  });

  router.post('/logout', (req, res) => {
    const token = tokenFromHeader(req.header('authorization'));
    if (!token || !sessionStore.revoke(token)) {
      return res.status(401).json({ error: 'invalid session' });
    }

    return res.status(204).send();
  });

  return router;
}
