# Alineo app guide

Alineo helps a company set objectives, measure key results and review progress.
Use [README](README.md) for setup, [development](docs/development.md) for the code
layout and [limitations](docs/limitations.md) for operational boundaries.

Workspaces separate organizations. Admin, Manager and Member permissions combine
with manager relationships, team membership and explicit objective/KR access.
Company, team and restricted visibility must be enforced on direct API requests,
search, reports, exports and notifications as well as the interface.

Objectives can align within a cycle without circular parent relationships.
Their progress comes from their own direct key results, not double-counted child
objectives. Numeric, percentage, currency and binary metrics support increasing or
decreasing targets; measured progress is clamped to 0–100. Empty objectives remain
unmeasured. Check-in history is append-only: the newest effective, non-superseded
entry supplies the current value, with deterministic tie-breaking. Backdated
updates and linked corrections retain their history.

Use comments, in-app notifications, reports, CSV workflows and archive/restore
according to the available role actions. Optional email needs your own configured
transport; automatic reminder sweeps need your own scheduler. No delivery account
or live workspace data is included.

Company Admins can export a JSON backup. Restore is an explicit privileged tool,
not a template startup task. Read [backup/recovery](docs/backup-and-recovery.md)
for transaction/session/credential behavior and isolated verification boundaries.
