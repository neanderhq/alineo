# Verification

Run `pnpm verify` after [development setup](development.md). It checks TypeScript,
the existing OKR calculation/history suite and focused source-security regressions,
repository policy and standalone
production build. Build and `/api/health` need no live credentials.

## CI

- **policy** checks identity/docs, runtime pins, direct audited entrypoints,
  immutable Actions and the production verification entrypoint.
- **app** runs source tests, publishing-recipe tests and production build.
- **Runtime security** builds the real image, scans vulnerabilities and embedded
  secrets with checksum-verified Trivy, migrates disposable PostgreSQL, seeds
  fictional records and runs `pnpm test:production` with Chromium.
- **Dependency audit** audits every committed lockfile, including bundled starter
  and development packages. **Dependency review** rejects new known advisories.
- Extended CodeQL, secret scanning/push protection and weekly Dependabot updates
  complement the app tests. Daily checks keep runtime/dependency scanning current.

`pnpm test:production` and `pnpm test:template` use the same real-image suite.
It must exercise the seeded product, meaningful permissions/history behavior,
persistence through restart/reseed and maintained recovery/session regressions.
It also checks admin-only bulk OKR imports, preview invalidation, goal and check-in
focus, and phone layouts with long cycle names. The selected OKR workflows
exercise direct-report requests and review state, private report views and
exports, and atomic batch confirmation with stale versions and a lost response.
They use desktop and 375px Chromium viewports with keyboard interactions.
Recorded passing evidence describes what was actually run; these instructions do
not establish a successful production deployment.

## Disposable runtime

Use `.github/workflows/check.yml` as the executable setup. Apply
`.neander/migrate.mjs`, run the fictional seed and provide the built
`NEANDER_TEMPLATE_IMAGE`. `DATABASE_URL` and
`NEANDER_TEMPLATE_TEST_DATABASE_URL` must identify the same explicitly disposable
local database. Supply exact local `BETTER_AUTH_URL` /
`NEANDER_TEMPLATE_TEST_ORIGIN`, generated `BETTER_AUTH_SECRET`, `DEMO_PASSWORD`
and a synthetic scheduler secret when testing that endpoint.

The original live API/archive suites remain in `scripts/`; run them only using
their explicit isolated fixture setup. They can create/delete their own rows.
Recovery tests must preserve real-user boundaries: use newly generated fictional
exports, never the delivery workspace snapshots. Keep session revocation, fresh
passwords, one-time reset tokens, complete field preservation, manifest mode0600
and rollback coverage. Never run a restore against the original project.

Store reports/browser captures outside source or in ignored `.cache/`. Only
sanitized, deliberately reviewed screenshots belong in the committed gallery.
Scanners cannot prove absence of vulnerabilities. Local checks do not certify
managed Neon rollout, external email delivery or a live customer deployment.
