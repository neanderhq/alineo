# Stack

Alineo uses Next.js App Router, React and TypeScript with its existing UI
components. Better Auth owns authentication/sessions, and Drizzle with PostgreSQL
owns workspace data and versioned migrations.

The production app is an unprivileged standalone Node container. Environment and
migration ownership live in `.neander/compose.yaml`; builds and public health do
not need live credentials. Migration, fictional initialization and privileged
backup recovery are separate explicit operations.

Server services enforce active tenant membership, roles, managerial scope and
record ACLs. Optional email/webhook delivery and scheduled reminders use only
operator-supplied server configuration. See [development](../development.md),
[testing](../testing.md) and [limitations](../limitations.md).
