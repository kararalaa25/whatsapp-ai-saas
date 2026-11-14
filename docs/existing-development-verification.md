# Existing-development compatibility verification results

## Result and scope

The selected complete SQL chain **passed on disposable PostgreSQL**, including
coexistence with a different platform subscription catalog. The hosted development
database was not accessed or modified. Its actual prerequisites remain **unverified**
until the administrator runs and reviews the supplied preflight. Real Supabase
Auth/PostgREST/SSR/browser integration is **NOT TESTED** in this task.

Starting commit: `3f7628417f9792bbacf5954c0eec19bb26011a03` from
`integration/phase8-supabase-readiness`. Work is isolated on
`integration/phase8-existing-dev-compatibility` in `/workspace/wasla-dev-compat`.
All historical migrations, main, prior branches/worktrees and unrelated local work
were preserved. Exact administrator order: [manual installation guide](existing-development-migration.md).
The machine-readable [ordered file/hash manifest](../supabase/manual/existing-development-order.json)
lists the exact eleven manual steps; only steps 2, 5 and 8 are schema writes.

## Confirmed defect and forward-only solution

Original Phase 8 tries to create `public.subscription_plans`, which collides with
the user's existing platform design. The representative disposable fixture
reproduced the `already exists` failure and verified rollback without platform
changes. An empty table with policies and dependent FKs is not safe to replace.

The new **alternative unapplied Phase 8 installer** creates
`public.wasla_subscription_plans`. All workspace subscription/invoice FKs and
plan-dependent functions reference this separate catalog. No platform column type,
policy predicate, empty-table assumption or administration authorization model is
invented as a hosted fact. It does not run after original Phase 8 and cannot repair
an already-applied original installer. It belongs to the manual selected chain;
future CLI history adoption remains a separately reviewed baseline operation.

Existing function definitions are kept: new bounded ingestion is
`public.ingest_wasla_whatsapp_test_message`. The application uses that exact RPC;
there is no fallback to legacy ingestion. Both legacy definitions remain, with
their external execution grants intentionally revoked to close alternate quota/
retention paths. The platform table/policy/FK/grant definitions are untouched.
7A/7B and subscription triggers intentionally enforce future application writes.

Billing still uses owner-only `get_workspace_billing` and the same JSON contract;
no UI shape change is needed. Its SQL reads the new catalog. The real API smoke
tool and unit/route fixtures target the final schema/RPC. Provider acceptance and
both outbound WhatsApp implementations retain unconditional hard stops.

## Exact isolated environment and verification

Date: 2026-11-14. Debian 13 Linux x86_64; Node 24.22.1, npm 11.9.0, Next 16.4.6.
Docker Engine 29.9.2, rootless VFS backend, explicit local Unix Docker socket.
Only cached official PostgreSQL image
`postgres@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07`
was used; actual image ID
`sha256:140936e8665d5274aa58df31b722693b4b451c541bb0f1a263a345d424bfacb4`.
Engine inside the fixture: PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1).

The runner creates a new uniquely labeled networkless container, no published
ports, no host/volume bindings, read-only root, 512 MiB database tmpfs plus bounded
socket/temp tmpfs, 1 GiB memory and 256 PID bound. The target database names are
new `wasla_phase9a_suite` / `wasla_phase9a_repeat` inside that owned container.
Container/isolation checks precede database creation; every SQL request rechecks
container identity and the newly created DB allowlist. SQL uses `docker exec` and
a Unix socket; `inet_server_addr() IS NULL` is checked. It accepts no remote DB URL,
credentials or existing target. No PostgreSQL server in the workspace/host/shared
project is used. Only this run's container is removed afterward; original cached
image retained, no containers or volumes left, no prune or daemon changes.

The schema contains synthetic `auth.users`, `auth.uid()` and standard API roles,
with deliberately permissive defaults to exercise explicit revocations. These
are SQL **stubs**, not real Supabase Auth, JWT verification or PostgREST. No production
credentials, OpenAI/payment/Meta call or WhatsApp send occurred.

The platform fixture deliberately uses a bigint identity plan ID, title/enabled
columns, dependent business-subscription FK, two RLS policies and an existing
function reading platform plans. This is a **representative** incompatible schema,
not a fabricated description of the hosted project's unknown columns.

## Actual results

Final [sanitized evidence](../verification/compatibility/results.json) includes
isolation proof, engine, source hashes, guard checks, preservation snapshots,
test names/results, route bridge scope and cleanup.

| Check | Result and limits |
| --- | --- |
| Complete selected chain | PASS twice: first six original migration files then manual Phase 8 replacement; never original Phase 8 plus replacement |
| Existing tenant upgrade | PASS: synthetic owner/workspace, verified history/connection and 30-product catalog seeded after 6A, then 7A/7B/8 backfill preserves history/over-cap records and initializes trial/disabled automation |
| Platform preservation | PASS on both targets: identical original relation metadata, columns, policies, constraints/FKs, table ACLs and dependent function definition; original FK usable in rollback-only test; Wasla has four separate plans |
| Existing functions | PASS: definitions of all pre-7A and pre-8 public/private functions preserved, including both legacy ingress definitions; intentional legacy EXECUTE revocations separately checked |
| Missing 7B prerequisite | PASS: compatibility installer rejects before any Wasla catalog creation, twice |
| Original conflicting installer | PASS as negative test: expected existing-table failure with unchanged platform snapshots, twice |
| Replay | PASS as negative test: replacement replay rejects existing Phase 8 objects; no data loss |
| Read-only SQL scripts | PASS: six new phase-specific pre/postflights at correct stages on both targets; final inventory and integration postflight also execute on both |
| Real PostgreSQL tests | PASS: **30 cases**, zero failures/errors, including 28 prior Phase 9A cases and 2 compatibility regressions |
| Signed route → database bridge | PASS: **9 checks** using actual webhook route/ingestion adapter and real SQL; RPC transport substituted, not PostgREST |
| Application unit/regression suite | PASS: `npm test`, **217 passed**, zero failures/skips; models/source assertions are not PostgreSQL proof |
| TypeScript | PASS: `npm run typecheck` (`next typegen && tsc --noEmit`) |
| Lint | PASS: zero errors; existing unused `_cacheHeaders` warning remains in Supabase server helper |
| Production build | PASS: actual `npm run build`, all routes compiled; no hosted/provider connection implied |
| SQL static parsing | PASS: pglast 8.8 parses original chain, manual replacement and all pre/postflights, including 57 PL/pgSQL function bodies across original/alternative sources; actual binding/transaction behavior proved only by disposable tests above |
| Diff integrity | PASS: historical seven migration files unchanged; `git diff --check` passed |
| Hosted prerequisite/schema verification | **NOT TESTED**: based on user baseline plus provided fail-fast/manual inspection queries |
| Real Supabase Auth/JWT/PostgREST/cache/SSR/browser | **NOT TESTED**; full local Supabase stack remains blocked by previously documented VFS storage constraints |

No final unexpected failed check remains. The original-installer failure, missing-
prerequisite failure and replay rejection are **expected negative tests**, not
claims of a successful original migration. A preliminary full run also passed;
the final run additionally validates the prerequisite/conflict rejection paths.

Thirty cases cover owner/member/anon/service contexts, foreign workspaces/sources/
assignees, private functions/tables/sequences, unauthorized upgrades/forged billing,
trial/NULL grace, quotas/AI reservations, last-unit and duplicate races, raw/intake
transaction boundaries, batch continuation, queue saturation, reconciliation limits,
identity ordering/retries, human takeover, draft approval and automation completion.
Disposable SQL evidence does not prove actual hosted defaults or JWT integration.

## Before manual application and later release

- Run every preflight, compare real prerequisite definitions/keys/ACLs, and save
  actual platform policy/FK/function evidence privately. If any expected new name
  already exists, stop; do not drop/rename/overwrite it. Hosted schema compatibility
  beyond the provided baseline is not established by this report.
- Review existing workspace capacity and the one-time trial backfill. Approve
  expiry communications/recovery, finite-provider-retry saturation response,
  retention/privacy and monitoring policies. Paid activation/renewal remains disabled.
- Inventory any external caller of legacy ingress before restricting its grant.
  Keep write/intake traffic paused through schema/app contract alignment.
- Validate actual PostgREST schema visibility, RPC ACLs and real owner/member JWTs,
  then run authenticated browser flows using synthetic accounts. Keep API private
  schema unexposed. SQL Editor administrator queries bypass RLS.
- Reconcile manual versus CLI migration history explicitly before future automatic
  tooling. This branch does not authorize merge/main changes, hosted SQL, provider
  activation or deployment. PR #1 remains unmerged.
