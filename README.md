# Expense API

A deliberately small expense-tracking REST API. This is the **target codebase**
for AutoSDLC agents: they read this repo, implement Jira stories against it, and
open pull requests here.

It is kept simple on purpose. Every feature an agent adds should be legible in a
diff, and a broken run should be recoverable with `git reset --hard`.

## Run it

```bash
npm install
npm start        # http://localhost:3000
npm test
```

## Data model

An expense is stored in **integer cents** and dated with an ISO-8601 date string:

```ts
{
  id: string,            // uuid
  description: string,
  amountCents: number,   // integer, > 0
  category: string,      // free-form, lowercased on write
  spentOn: string,       // "YYYY-MM-DD"
  createdAt: string      // ISO-8601 timestamp
}
```

## Endpoints

| Method   | Path             | Notes                                                      |
| -------- | ---------------- | ---------------------------------------------------------- |
| `GET`    | `/health`        | Liveness check                                             |
| `POST`   | `/expenses`      | Create. Validates with Zod, returns `201`. If the category has a limit and this expense pushes its month-to-date total (for the month of `spentOn`) over the limit, the body also carries `warning: { category, month, limitCents, spentCents, overByCents }` |
| `GET`    | `/expenses`      | List. Optional `category`, `from`, `to` query filters      |
| `GET`    | `/expenses/:id`  | Fetch one, or `404`                                        |
| `DELETE` | `/expenses/:id`  | Delete one, `204` on success or `404`                      |
| `PUT`    | `/limits/:category` | Upsert a monthly spending limit, `200` with the stored limit |
| `GET`    | `/limits`        | List all limits, sorted by category                        |
| `DELETE` | `/limits/:category` | Delete one, `204` on success or `404`                   |
| `GET`    | `/limits/usage`  | Month-to-date usage per limit. Optional `month=YYYY-MM` query param, defaults to the current calendar month |

## Conventions

Read [CONVENTIONS.md](./CONVENTIONS.md) before changing anything. It is the
contract agents and humans both work to.
