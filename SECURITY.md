# Security

Report vulnerabilities through this repository's **Security → Report a
vulnerability** page, which opens a private advisory. Include the affected commit,
impact and reproduction steps. Never post workspace exports, credentials,
provider keys, recovery manifests or exploit payloads in public issues.

Current `main` is the maintained version. The repository baseline includes
extended CodeQL, dependency alerts/security updates, secret scanning/push
protection and private reporting. PR/daily checks audit every committed lockfile,
including development and bundled starter dependencies. Dependency review rejects
new known advisories; weekly Dependabot covers npm, Actions and Docker. Changes
still require app verification and maintainer review.

Public app CI is read-only, SHA-pinned and has no cloud keys. Neander's private
publisher verifies the exact source revision, scans tested runtime images before
registration and rescans registered immutable digests daily. Source updates do
not patch existing published images or user deployments until republished.
Scanners cannot prove absence of vulnerabilities.

Preserve tenant/role/ACL enforcement, mutation Origin checks, private export
access and recovery session-revocation/rollback/credential-manifest behavior.
Runtime requests must never recreate an account with a fixed password. Keep
initialization explicit and deployment credentials generated.

Keep dev/build/start entrypoints direct and audited. Do not add dynamic remote
code evaluation, obfuscated loader chains, hidden folder-open tasks or unreviewed
package lifecycle hooks. Use fictional fixtures and separate application tests
from privileged operational recovery. Read [limitations](docs/limitations.md).
