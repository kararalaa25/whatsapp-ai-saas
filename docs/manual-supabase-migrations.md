# Manual Supabase SQL Editor migration runbook

> **Existing development database compatibility:** use
> [the current exact SQL order](existing-development-migration.md) for the
> user-confirmed platform catalog collision. Do not run the original Phase 8
> installer on that database. The current application uses the separate Wasla
> plan catalog and ingestion RPC described there. Earlier results below are
> historical and do not establish the hosted schema state.


Preparation only. **Nothing in this runbook has been run on a hosted project.**
The user has authorized preparing SQL, not applying it to an existing shared
database. A human must authorize the specific target and change window before
execution. Rehearse first on a new, dedicated development project containing
synthetic data only. Never use a production project as the rehearsal target.

## Establish the actual baseline

The complete chronological chain under `supabase/migrations/` is:

| Order | Exact filename | Repository evidence for a previously used test project |
| --- | --- | --- |
| 1 | `20261114000000_workspace_foundation.sql` | Reported manually applied in `ai-agent-preview.md`; header still says unapplied |
| 2 | `20261114010000_whatsapp_test_foundation.sql` | Reported manually applied in the same document |
| 3 | `20261114020000_ai_agent_playground.sql` | Reported manually applied in the same document; header still says unapplied |
| 4 | `20261114030000_business_knowledge_catalog.sql` | Delivered unapplied in Phase 6A; no authoritative hosted application confirmation found |
| 5 | `20261114040000_whatsapp_conversation_inbox.sql` | Phase 7A: pending according to roadmap/merge review |
| 6 | `20261114050000_whatsapp_automation_draft_engine.sql` | Phase 7B: pending according to roadmap/merge review |
| 7 | `20261114180000_phase8_subscriptions.sql` | Phase 8: pending, includes durable deferred intake |

All seven passed in the **Phase 9A disposable PostgreSQL fixture**, which had
minimal Auth stubs and permissive default grants. That does not establish any
hosted project's migration state or real Auth/PostgREST behavior. Do not infer
application from branch names, file headers, a successful UI build or table names.

1. Record Dashboard organization/project name, reference and environment. Have a
   second operator confirm the target is dedicated development, not an existing
   shared/production project. SQL `current_database()` is usually `postgres` and
   cannot identify a project. Keep the target record outside public git logs.
2. Pin the reviewed integration commit and record file hashes locally:

   ```sh
   git rev-parse HEAD
   shasum -a 256 supabase/migrations/*.sql
   ```

3. In SQL Editor, select the migration administrator (`postgres`). Run only
   [integration-inventory.sql](sql/integration-inventory.sql). It uses a read-only
   transaction, returns schema metadata rather than customer content, and tolerates
   missing application objects. Required roles are `anon`, `authenticated`,
   `service_role`, `authenticator` and `postgres`; `auth.users` and `auth.uid()` must
   exist. Do not replace real Supabase Auth with the Phase 9A fixture stubs.
4. If `optional_history` is non-null, separately run:

   ```sql
   BEGIN READ ONLY;
   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
   ROLLBACK;
   ```

   If absent, record history as unavailable, not empty/applied. SQL Editor runs
   do **not** automatically register CLI migration history. Compare exact object
   definitions, constraints, triggers, owners and effective ACLs with the reviewed
   source, plus prior administrator records. Function-definition MD5 fingerprints
   in inventory are for comparing snapshots, not migration-file SHA256 hashes.
5. Classify each file as verified applied, verified absent, or unknown/drifted.
   Existing matching tables alone are insufficient. If history and objects
   disagree, stop and investigate. Do not replay a migration to repair history.
   Keep a secure manual ledger (project, file SHA256, operator, UTC time, result,
   before/after evidence). Later CLI history reconciliation requires a separately
   reviewed plan; do not insert guessed history or blindly run `db push`.

A fresh project should have no application objects and needs **all seven** files.
For an existing test project, 7A cannot proceed until files 1–4 are verified.
The Phase 6A uncertainty is a real prerequisite gate, not permission to skip it.

## Backup and change-window gate

- Review pending SQL and impact with the owner. Confirm approved trial/backfill
  duration, existing above-limit workspaces and recovery policy before Phase 8.
- Obtain a provider-supported backup/export appropriate to the project tier;
  include application schemas, private schemas, Auth dependencies, ownership/grants
  and migration records. Store encrypted outside git. Confirm retention/access.
  A Dashboard backup listing alone is not a tested restore. Rehearse restoring to
  a separate disposable target and verify row counts/relationships and Auth needs.
- Record aggregate baseline counts for workspaces, members, connections, source
  messages, conversations/messages, catalog and FAQs. Phase preflights return
  workspace IDs/counts: keep their output private. No bodies, tokens or passwords
  belong in tickets/screenshots/commits.
- Stop application writes and signed intake in the approved window. Do not allow
  a half-upgraded app to write between files. Review lock/statement timeouts and
  expected backfill sizes with the administrator; do not disable triggers, RLS or
  constraints to make a migration pass. Arrange inbound retry/backpressure handling
  before pausing any real intake (none is activated by this procedure).

## Execute one complete reviewed file at a time, only after authorization

Every migration already includes `BEGIN;` and `COMMIT;`. Copy the **entire file**,
without Markdown fences or extra wrapping transactions, into a separate SQL Editor
tab. Do not execute a selected fragment. Require successful final commit, then
postflight, before the next file. The files are **not idempotent**. If a request
times out, the commit outcome is unknown: inspect state before any retry.

For an empty dedicated target, apply files 1, 2, 3, 4 in order and check their
objects/ACLs using inventory and the Phase 6A pre/postflight before continuing.
On an existing target, skip only files independently verified applied. Do not
modify historical files or replace existing application tables.

| Step | Before | Entire migration to run | After / required result |
| --- | --- | --- | --- |
| 7A | [phase7a-preflight.sql](sql/phase7a-preflight.sql): all foundation/AI/knowledge prerequisites present, new inbox objects absent | `supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql` | [phase7a-postflight.sql](sql/phase7a-postflight.sql): RLS on, postgres owners, owner SELECT, no client DML, four enabled inbox triggers, zero missing state/unmatched verified customer sources |
| 7B | [phase7b-preflight.sql](sql/phase7b-preflight.sql): complete 7A, timezone support, new automation objects absent | `supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql` | [phase7b-postflight.sql](sql/phase7b-postflight.sql): RLS/ACLs correct, disabled settings for all workspaces, enabled initializer, no fabricated runs or delivery |
| 8 | [phase8-preflight.sql](sql/phase8-preflight.sql): complete 7A **and 7B**, review all above-trial capacities, new subscription/intake objects absent | `supabase/migrations/20261114180000_phase8_subscriptions.sql` | [phase8-postflight.sql](sql/phase8-postflight.sql), then [integration-postflight.sql](sql/integration-postflight.sql), then inventory: ten enabled subscription triggers including BOTH automation guards, all workspaces subscribed, no unexpected invoices/events |

The older phase scripts query `supabase_migrations.schema_migrations` directly.
If the initial inventory found it absent, run their remaining read-only statements
individually, omit only the history SELECT, and record the omission and manual
ledger. Do not create a fake migration-history table. Run these scripts only at
their documented stage; some casts require existing prerequisite tables.

Phase 8 conditionally installs automation guards only when 7B tables exist. This
runbook **requires 7B before 8**. If 8 is already applied without these guards,
stop automation use: commission a new forward migration. Never replay 8 to add them.

## Review compatibility and authorization after every step

- `public` is the application Data API schema. Never expose `workspace_private`.
  Schema USAGE for an RLS helper is not permission to expose its private tables.
  Check actual Data API schema settings and explicit table/function grants.
- All application tables enable RLS. Workspace membership uses actual `auth.uid()`
  plus stored membership, never user-editable metadata. Workspace creation derives
  the owner from the authenticated caller. Most feature tables/RPCs are owner-only;
  ordinary members intentionally retain the older own-tenant raw WhatsApp monitor.
- Authenticated clients have SELECT on permitted public tables, not direct
  subscription/catalog/inbox writes. Most mutations are checked RPCs. Inspect
  effective privileges (including PUBLIC/inheritance), not just visible grants.
  `subscription_plans` is intentionally readable by authenticated users globally.
- Definers must be owned by `postgres` with empty search paths and narrow grants.
  Public owner RPCs require ownership inside SQL. Only the verified-ingress v2 RPC
  is service-role executable; the old raw-only RPC loses that grant in Phase 8.
  Private functions/tables/identity sequences must not acquire client execution or
  access. RLS does not protect against a superuser or broadly privileged credential.
- SQL Editor's administrator session bypasses RLS. Catalog queries there are **not**
  tenant tests. Run real JWT/PostgREST checks and browser owner/member/foreign tests
  from [local instructions](local-supabase-testing.md) after schema review.
- If PostgREST still reports missing relations/functions after successful commit,
  inspect API logs and actual definitions. A separately authorized administrator
  may request `NOTIFY pgrst, 'reload schema';` after the chain. This is an operational
  action, not part of the read-only smoke scripts. Never fix a stale cache by
  exposing private schemas or granting broad PUBLIC execution.

## Phase 8 effects to approve and observe

Existing workspaces receive one 14-day provisional trial at migration time;
new workspaces initialize trial, disabled automation and owner in one transaction.
Trial duration is centrally configured; running migrations again is not a reset.
Raw stored status can remain `trialing` after its deadline: effective access checks
use database time and deny expired trials without a background status job.
`past_due` without a grace deadline denies access. Paid activation/renewal is disabled.

Trial capacities are 25 products, 25 FAQs, one connection and one member, including
inactive/disabled rows. Existing above-limit records remain; additions are blocked.
AI provider reservations and **new** WhatsApp test conversations each default to 50
per UTC calendar month, alongside older abuse caps. Existing customer conversations
can append verified history after expiry; this does not grant new AI/automation.
Simulated playground previews do not consume provider quota. Inbox draft inserts,
including manual drafts, require their respective subscription feature and access.
Do not promise that every simulation surface is available after expiry.

New-customer intake at quota/expiry is durably deferred, up to 1000 unresolved
eligible texts per workspace. A 1001st unresolved event rolls back and returns
503, while later valid events in that webhook batch are still attempted. Duplicate
replays do not consume quota or retry budgets. Reconciliation is owner-only,
25 eligible rows/run, once/minute, five-minute event spacing, five processing-fault
attempts; it cannot restore expired entitlement or activate a paid plan.
Source history is retained; no automatic purge or bulk historical projection is
installed. Review the detailed [Phase 9A operations policy](phase9a-verification.md)
and owner decisions before a pilot. Alert on sustained 503s, failed intake, growing
backlog, oldest age and capacity thresholds; never log message bodies. Establish
response ownership and escalation before the upstream provider's retry window ends.

## Failure and forward-fix strategy

1. Stop at the first error. Do not continue later files or retry fragments.
   If a transaction remains aborted in the Editor session, `ROLLBACK;` clears
   that session; it does not undo a committed migration. Re-run inventory to
   establish actual state. A disconnected client is not evidence of rollback.
2. Preserve SQLSTATE, sanitized error, exact file hash and pre/post metadata.
   Never delete existing data, drop schemas, disable subscription guards or
   loosen grants to resume. Keep the application/intake paused as appropriate.
3. If uncommitted, correct the target prerequisites under a reviewed plan and
   rerun the entire **unchanged** migration only after absence is verified.
   If committed, preserve it and create a separately reviewed uniquely versioned
   forward correction with compatible application code and regression evidence.
4. For unknown/drifted state or 8-before-7B, reconcile objects/history first.
   Do not automatically repair migration history or copy fixture SQL into Auth.
5. Restore only as a separately authorized incident action, to a verified target,
   accounting for writes since backup and Auth consistency. Removing the new
   columns/tables is not a safe downgrade. Restoring an app version alone may
   leave a changed RPC contract (notably retired raw ingress).

Completion requires saved postflight evidence **and** real Auth/PostgREST/browser
results. This prepared runbook is not a declaration that migrations or integration
passed. Existing shared-project changes, merge and deployment remain unauthorized.
