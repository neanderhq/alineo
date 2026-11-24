# Alineo development

Read `README.md`, [development](docs/development.md), [testing](docs/testing.md)
and [limitations](docs/limitations.md) first. Alineo is a PostgreSQL-backed OKR
app with Better Auth sessions; it is not a database-free starter.

Use the pins in `mise.toml`. Install locked dependencies, use an explicitly named
local Compose project and preserve existing database volumes. Secrets belong in
ignored `.env.local` or the deployment-owned runtime bundle. Never commit real
workspace exports, recovery manifests, account credentials or provider keys.

Initialization belongs to the explicit fictional seed command. Runtime requests
must not recreate demo accounts or set a known password. Repeating a seed must
preserve user edits and passwords. Database migrations run separately from image
build and startup, using committed Drizzle SQL. Auth schema comes from the pinned
Better Auth CLI, followed by Drizzle generation; do not use `auth migrate`.

Keep workspace, role, manager hierarchy and record ACL checks on the server.
Preserve mutation Origin checks, append-only check-in/correction history and
permission-filtered search/reports/exports/notifications. Recovery must retain
transaction rollback, affected-user session revocation and private credential
manifest behavior; see the recovery guide before changing it.

Run focused checks plus `pnpm verify`. `pnpm test:production` requires the real
built image and explicitly disposable local database, generated test secrets and
Chromium. Use fictional fixtures and clean up only the test's own resources.

Keep `dev`, `build` and `start` as direct audited Next entrypoints. Do not add
remote-code loaders, hidden folder-open tasks, automatic account bootstrapping or
unreviewed executable package hooks. Public Actions must remain SHA-pinned,
read-only and credential-free. Repository policy and security checks are required
before merge; never disable a check to conceal a finding.

## Installed Next.js documentation

This project uses the pinned Next.js version. Read its installed documentation
in `node_modules/next/dist/docs/` before changing framework APIs or conventions.
