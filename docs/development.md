# Development

Alineo uses Next.js App Router, React/TypeScript, Better Auth, Drizzle and
PostgreSQL. UI routes are in `app/`, reusable OKR UI is in `components/okr/`,
server-side policies and data services are in `server/`, and versioned SQL and
metadata are in `drizzle/`. `project.json` identifies this public template.

Use Node 24.22.3 and pnpm 11.18.0. Install with
`pnpm install --frozen-lockfile`; policy checks also need Python 3 and
`PyYAML==6.0.3`. Use `docker compose -p alineo-dev -f compose.dev.yaml up -d --wait`
for the opt-in local database, then copy `.env.example` to ignored `.env.local`.
Generate your own auth secret and demo password. Never use a customer database as
a development fixture. Use a different project and free host port if needed.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local Next.js app |
| `pnpm check` | Generate route types and run TypeScript |
| `pnpm test` | Existing OKR calculations/history tests |
| `pnpm test:policy` | Repository and executable-path conventions |
| `pnpm build` | Standalone production output |
| `pnpm verify` | Source, policy and build |
| `pnpm db:migrate` | Apply committed Drizzle migrations |
| `pnpm db:seed` | Explicit fictional initialization |
| `pnpm test:production` | Built-image/database/browser verification |

The API owns permissions. Preserve tenant isolation, active memberships, manager
reporting scope and explicit objective/KR ACLs across direct reads, mutations,
search, notifications and exports. Current values must continue to follow the
newest effective, non-superseded check-in rather than insertion order alone.

Optional delivery is server-side only: your own Resend key and sender or your own
HTTPS transactional/reset webhook. Empty configuration must remain in-app only;
never send external email during tests. A periodic reminder sweep needs your own
scheduler and `REMINDER_SWEEP_SECRET`; Admin-triggered sweeps do not provision a
scheduler. Keep all provider credentials out of browser variables and evidence.

Use the [publishing contract](deployment-contract.md) when changing environment or
migration requirements. Keep database migration outside build/startup and preserve
the runtime secret-bundle parser. Read [backup/recovery](backup-and-recovery.md)
before changing restore behavior; backups and generated credentials remain private.
