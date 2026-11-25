# Backup and recovery

Alineo stores workspace data in PostgreSQL. Company Admins can request
`GET /api/exports/backup` while authenticated to download their authorized
workspace JSON. Backups can contain staff identities, access lists, invitations,
notifications and goal/history records. Treat them as private data, not public
repository fixtures.

This repository includes the recovery utility, not a delivery workspace backup.
Use an explicit backup file that you own and are authorized to restore. Template
fixtures and verification exports are fictional and must remain separate from
real organization backups.

## What recovery preserves

The supported export/restore contract includes company/staff memberships,
manager reporting lines, teams/rosters, cycles, objectives/ACLs, key results and
editors, check-ins and linked corrections, comments, audit events, invitations
and notifications. Preserve IDs, access fields and history; do not replace a full
backup with hand-copied goal rows.

Personal saved report views and queue review marks are stored in PostgreSQL
and excluded from the portable workspace JSON. Use a database backup to retain
them. The portable export includes every committed batch check-in in ordinary
history. Restoring the workspace clears its batch retry receipts.

Identity credentials are treated separately from business records. By default, the restore
utility creates new high-entropy temporary credentials for affected accounts and
writes a private credential manifest. It revokes affected users' sessions and
invalidates their prior reset/recovery credentials. Unrelated accounts/sessions
must remain unchanged. Stored password hashes and live session tokens are not
portable sharing data.

Database restore changes run in a transaction. A SQL failure before commit rolls
back business and identity changes and leaves the previous credential manifest
unchanged. The generated manifest is written after database commit and restricted
to mode `0600`, including replacement of an existing file. Database and filesystem
writes are not a single cross-resource transaction: ensure the private output
location is writable before an actual restore. Isolated tests cover SQL rollback
and manifest permissions; they do not replace managed database backups or an
operator recovery plan.

## Explicit operator procedure

1. Export the authorized workspace, keep the file private and preserve a separate
   database backup under your normal policy. Check which records/company the
   export identifies before proceeding.
2. Prepare an isolated PostgreSQL database first. Install locked dependencies and
   apply the committed migrations with its explicit `DATABASE_URL`. Verify restore
   behavior there before considering a real database operation.
3. Supply your own database URL through a private environment file or secret
   manager, then run the utility with an explicit backup path:

   ```sh
   node --env-file=/private/path/recovery.env scripts/restore-backup.mjs /private/path/workspace-backup.json
   ```

4. Review the utility's completion output and privately stored credential
   manifest. Share each replacement credential only with its intended account
   owner through a trusted channel. Require a fresh sign-in and verify old
   sessions and old passwords no longer work.
5. Check workspace memberships/roles, reporting lines, ACLs, IDs, records and
   effective progress/history. Verify unrelated accounts still work. Retain or
   securely dispose of backups/manifests according to your organization policy.

Never paste a backup, bearer reset URL, credential manifest or database URL into
public issues, logs, screenshots or chat. A new template project is initialized
with `pnpm db:seed`; restoring a backup is a separate, explicit operator action.
Seeding is not a password recovery tool and must not overwrite existing passwords.

## Verification boundaries

Recovery/session tests use disposable databases, synthetic users and newly
created fictional backups. They check field/ID preservation, multiple affected
sessions and unrelated-session retention, fresh passwords, one-time reset behavior,
manifest permissions and a deliberately failed restore's atomic rollback.
Production recovery, actual provider email delivery and managed database backup
restoration require separate authorized operational verification.
