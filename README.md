# Alineo

An open-source OKR workspace inspired by Betterworks. Connect company, team and
individual objectives, measure key results and keep a history of progress,
confidence, notes and corrections.

Alineo is a [Neander](https://neander.ai) template application. Start from its
source, customize your own project and deploy through ordinary Publish. The
MIT-licensed app is independent of Betterworks and is not affiliated with it.

## What is included

- Company workspaces, teams and Admin, Manager and Member roles.
- Quarterly/custom cycles, aligned objectives and numeric, percentage, currency
  and binary key results.
- Company, team and restricted visibility, with explicit viewers/editors and
  server-side permissions.
- Check-in history, confidence, notes, blockers, backdated updates and linked
  corrections; comments, mentions and in-app notifications.
- Reporting, admin CSV imports, permission-filtered exports, cycle carry-forward and archive/restore.
- Admin JSON backup export and an explicit operator restore tool.

Email delivery and automatic reminder scheduling require your own optional
configuration; they are not provisioned by the template. Read
[limitations](docs/limitations.md) and [backup and recovery](docs/backup-and-recovery.md)
before using real workspace data.

## Run locally

Use Node **24.22.3**, pnpm **11.18.0**, Docker and PostgreSQL. Versions are pinned
in `mise.toml`.

```sh
pnpm install --frozen-lockfile
docker compose -p alineo-dev -f compose.dev.yaml up -d --wait
cp .env.example .env.local
```

The opt-in database listens on loopback port `55450`. Check for conflicts first.
Its `alineo_dev` / `alineo_dev_only` user/password are local development fixtures,
never deployment credentials. Fill the ignored `.env.local` with your exact local
`BETTER_AUTH_URL` and newly generated `BETTER_AUTH_SECRET` and `DEMO_PASSWORD`.
Use at least 32 random bytes for the auth secret and a unique strong demo password.

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://127.0.0.1:3000` and sign in as `admin@alineo.test`,
`manager@alineo.test` or `member@alineo.test` using your generated `DEMO_PASSWORD`.
The sample workspace contains fictional records only. Seeding is explicit;
repeating it preserves later changes and passwords.

Run `pnpm verify` for source tests, policy and production build. See
[development](docs/development.md) and [testing](docs/testing.md) for image/database
verification. Stop your local database with the same named Compose project;
retain its volume when you want to keep local work.

## Deploy and customize

`.neander/compose.yaml` is the normal Neander publishing recipe. It declares
managed PostgreSQL, the public origin, generated secrets and a separately run
Drizzle migration profile. The image runs as an unprivileged user and exposes the
public, database-free `/api/health` endpoint. Builds do not need live credentials.

`.neander/template.yaml` owns library metadata, fictional seed commands and the
committed gallery. Neander's private publisher verifies an exact GitHub commit,
scans the tested image, and registers immutable image digests and screenshots.
Public app CI has no cloud credentials or private publisher code. Source stays in
GitHub; publication does not copy a live database or deploy a user application.

[Source attribution](docs/source-attribution.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
