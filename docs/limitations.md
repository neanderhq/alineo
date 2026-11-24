# Scope and operational limits

Alineo is an OKR starting point, with workspaces/teams, Admin/Manager/Member roles,
cycles, aligned objectives, key results, visibility/editors, check-ins and linked
corrections, comments/notifications, reporting, CSV operations and archive/restore.
Use the application's actual policies as authoritative; a delivered checklist or
a screenshot is not proof of a particular behavior.

## Delivery and scheduled work

No email provider, inbox, webhook or paid service is configured by the template.
Notifications can remain in-app. Password recovery delivery requires the
operator's own supported transport; do not assume an unconfigured deployment can
send a reset email. Automatic reminder sweeps require an operator-owned scheduler
and secret. The template does not create that scheduler.

## Data and recovery

Template fixtures are fictional. Explicit initialization uses generated secrets
and preserves later changes. No production records, credentials, recovery exports
or browser sessions are bundled in this repository.

Admin JSON export and `scripts/restore-backup.mjs` are application-level recovery
utilities, not managed database backup/retention infrastructure. Restore is an
explicit privileged operation against a database you own. It can overwrite backup
records and issue replacement credentials; affected sessions are revoked. Review
the [recovery guide](backup-and-recovery.md), keep backups/manifests private, test
on an isolated database and establish your own backup/data-lifecycle procedure.

A clean package/image scan does not certify every permission path or absence of
unknown vulnerabilities. Inspect focused app/runtime test evidence separately
from source-only checks and hosting/provider verification.
