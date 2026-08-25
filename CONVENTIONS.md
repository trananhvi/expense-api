# Conventions

These are the rules of this codebase. Follow them exactly — consistency here
matters more than any individual preference.

## Structure

- `src/types.ts` — domain types and Zod schemas. No logic.
- `src/store.ts` — data access. Pure, in-memory, synchronous. No HTTP concerns.
- `src/routes/` — one file per resource. Express routers only; no business rules.
- `src/app.ts` — assembles the app. `createApp()` returns a configured Express app
  and never listens on a port.
- `src/server.ts` — the only file that calls `.listen()`.
- `test/` — one file per resource, mirroring `src/routes/`.

## Rules

1. **Validate every request body with Zod**, in the route, before touching the
   store. Return `400` with `{ error, details }` on failure.
2. **The store never throws for "not found".** It returns `undefined`, and the
   route turns that into a `404`.
3. **Money is stored in integer cents.** Never use a float for an amount. The
   field is called `amountCents` everywhere, including in JSON responses.
4. **Dates are ISO-8601 date strings** (`YYYY-MM-DD`), not `Date` objects and not
   timestamps. Store them as strings; compare them as strings.
5. **No `any`.** If a type is awkward, name it in `src/types.ts`.
6. **Every new endpoint gets tests** covering the success path, one validation
   failure, and one not-found case where applicable.
7. **Prefer explicit over clever.** This codebase is read far more than written.

## Testing

`npm test` runs Vitest once; `npm run test:watch` watches. Tests start the app on
an ephemeral port with `createApp()` and use `fetch`. Do not add a HTTP-assertion
library — the built-in `fetch` is enough and keeps the dependency list short.

## Commits

Conventional Commits: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
Keep the subject under 72 characters and write it in the imperative mood.
