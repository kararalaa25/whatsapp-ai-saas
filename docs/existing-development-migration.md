# Existing development database: preserved platform billing compatibility

This is the **current manual installation path** for the user-described development
database. It starts from `integration/phase8-supabase-readiness` at
`3f7628417f9792bbacf5954c0eec19bb26011a03`. No hosted SQL has been executed.

User-confirmed baseline: Phases 4–6A application tables exist; Phase 7A/7B tables
are absent. `public.subscription_plans` has a different platform-administration
schema, zero rows and two policies, and is referenced by empty
`public.business_subscriptions`. Actual column definitions, function definitions,
owners/default grants and live migration history have **not** been retrieved.
The preflights below establish those facts before any manual write. A passing
synthetic test is not verification of those unknown hosted definitions.

## Compatibility architecture and preservation

- Existing platform tables are never renamed, dropped, altered or populated.
  Their existing policies, grants, sequences and foreign keys remain intact.
  Emptiness is **not** used as permission to replace them. No mapping between
  platform subscriptions and Wasla workspace entitlements is inferred.
- Wasla's four provisional plans live in **`public.wasla_subscription_plans`**.
  `public.workspace_subscriptions` and private invoices reference this new catalog.
  All quota, trial, billing and automation functions use it. The billing UI keeps
  the same owner-only DTO/RPC contract; its data comes from the isolated catalog.
  The read-only API smoke tool also queries the new catalog.
- Existing function definitions are preserved. The bounded ingestion function
  is newly named **`public.ingest_wasla_whatsapp_test_message`**, and the application
  ingestion adapter calls it without a legacy fallback. It still requires the
  server's signature verification and trusted test-number mapping. It does not
  accept a workspace, subscription state, quota, price or entitlement from clients.
- **Intentional execution-ACL change:** both legacy ingress functions remain
  defined, but PUBLIC/anon/authenticated/service-role execution is revoked from
  `ingest_whatsapp_test_message` and `ingest_whatsapp_ai_test_message`. Retaining
  service execution would allow a quota/retention bypass. Only the new ingress
  function is service-role executable. Identify any external consumers before the
  change window and migrate them to the signature-verifying server path. Do not
  restore legacy grants as a compatibility workaround. SQL administrators remain
  trusted; these revocations do not restrict postgres itself.
- Existing application tables receive the reviewed 7A/7B/8 workflow/entitlement
  triggers. This necessarily changes their future write behavior, but preserves
  their definitions/data/policies/FKs and existing function bodies. Above-limit
  historical data remains readable under its existing authorization.
- The new Phase 8 installer is a **forward-only alternative initial installation**,
  not a migration to run after original Phase 8. It fails transactionally on an
  existing new-phase table/function collision. It requires both 7A and 7B and
  postgres execution, so it cannot silently skip automation guards or overwrite
  another administration function. Any collision requires review, not deletion.

The historical seven files in `supabase/migrations/` are unchanged. On this target,
**do not run `supabase/migrations/20261114180000_phase8_subscriptions.sql`**: it
would collide with platform billing. Use the manual replacement below instead.
Do not run a glob of migration files, `supabase db push`, or both Phase 8 variants.
Manual SQL does not register CLI history. Record the actual replacement filename
and SHA256 in a private change ledger; do not falsely mark the original file as
applied. Future CLI history alignment needs explicit review of the alternative
baseline. No automatic migration/deployment command is installed here.

## Exact SQL Editor execution order

Before starting: confirm project name/reference, take and verify a restorable
backup, save private baseline metadata/counts, approve the change window and trial
policy, and pause writes/intake. Follow the backup/forward-fix detail in
[the manual runbook](manual-supabase-migrations.md). This task prepares the files;
it does not authorize this agent to execute them on the hosted database.

Use SQL Editor as `postgres`. Copy each complete file into a separate tab, execute
the **whole file**, and review its result before proceeding. Migrations already
contain BEGIN/COMMIT; do not wrap them or select fragments. Read-only pre/postflight
files use BEGIN READ ONLY/ROLLBACK. Stop at any error, missing object or unexplained
ACL/policy/constraint difference. Do not retry a timed-out commit without inspection.

| Order | Exact file | Required review |
| --- | --- | --- |
| 1 | [`docs/sql/existing-dev-phase7a-preflight.sql`](sql/existing-dev-phase7a-preflight.sql) | Phases 4–6A tables/functions present, new objects absent, owner helper uses real auth.uid(), trusted ingress signature and tenant composite constraints match repository |
| 2 | [`supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql`](../supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql) | Apply unchanged 7A; successful final commit |
| 3 | [`docs/sql/existing-dev-phase7a-postflight.sql`](sql/existing-dev-phase7a-postflight.sql) | Owner-only inbox grants/RLS, four enabled workflow triggers, zero missing state and zero unverified customer sources |
| 4 | [`docs/sql/existing-dev-phase7b-preflight.sql`](sql/existing-dev-phase7b-preflight.sql) | Complete 7A signatures/keys/timezones, no existing automation tables/functions |
| 5 | [`supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql`](../supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql) | Apply unchanged 7B; successful final commit |
| 6 | [`docs/sql/existing-dev-phase7b-postflight.sql`](sql/existing-dev-phase7b-postflight.sql) | Settings initialized disabled, RLS/grants/definer owners correct, source consistency |
| 7 | [`docs/sql/existing-dev-phase8-preflight.sql`](sql/existing-dev-phase8-preflight.sql) | Fail-fast dependency/collision check; save platform metadata/policies/FKs/counts; inventory trial capacities and original function fingerprints |
| 8 | [`supabase/manual/20261114180000_phase8_existing_development.sql`](../supabase/manual/20261114180000_phase8_existing_development.sql) | Run this alternative Phase 8 installer **once**; never the original Phase 8 file |
| 9 | [`docs/sql/existing-dev-phase8-postflight.sql`](sql/existing-dev-phase8-postflight.sql) | Four Wasla plans; unchanged platform objects/counts; workspace trial completeness; private ACLs; only new ingress service executable; bounded queue |
| 10 | [`docs/sql/integration-postflight.sql`](sql/integration-postflight.sql) | Zero missing subscription/automation/inbox state, zero unexpected events/invoices/queue violations; all ten enabled Phase 8 triggers, including both automation guards |

| 11 | [`docs/sql/integration-inventory.sql`](sql/integration-inventory.sql) | Inspect effective table/function/sequence ACLs, RLS, owners, policies and trigger definitions; compare original function fingerprints |

The new phase-specific pre/postflight variants do not depend on a CLI history table.
Keep all output private: workspace IDs/counts and SQL definitions are administrator
evidence, not a public report. No customer bodies are selected. Recheck actual Data
API exposed schemas: `public` only for these application objects; never expose
`workspace_private`. If necessary after verified commits, a separately authorized
administrator may request `NOTIFY pgrst, 'reload schema';`—not part of a read-only
check. Never broaden grants to fix an API schema-cache error.

Preflight 7A cannot prove arbitrary hosted schema equivalence by object names.
Review listed definitions/constraints against the first four repository migrations.
For example, the `(workspace_id,id)` source/conversation/connection keys and
`(workspace_id,user_id)` membership key are required. If already-created function
names or undocumented modifications differ, stop and prepare a specific forward
correction. Do not recreate or replay Phases 4–6A on this existing database.

## Trial, quota and deployment consequences

Applying 8 starts one centrally configured 14-day provisional trial for existing
workspaces. It does not import platform subscriptions or activate paid plans.
Trial capacities are 25 products/FAQs, one member and one connection (including
inactive/disabled rows), and monthly UTC usage limits apply alongside existing
abuse caps. Inventory over-capacity workspaces before applying; existing records
remain but new inserts can be denied immediately. Natural expiry blocks new
entitled processing even while stored status remains trialing.

Verified text to an existing conversation can continue appending history after
expiry; a new customer's event is retained/deferred without granting AI/automation.
The unresolved queue is bounded at 1000/workspace; saturation yields 503 for the
unpersisted event while later valid batch events are still attempted. Reconciliation
keeps the existing owner, batch, cooldown and fault limits and cannot reset trials.
No deletion, paid recovery or automatic purge is added. Trial communications,
retention, alert/on-call response and finite upstream retry-window policy need
owner acceptance before real business traffic.

Use [the local Terminal/browser guide](local-supabase-testing.md) after manually
validating the schema. App billing JSON shape is unchanged; new API ingress is a
required contract change. Restart the local app on this reviewed branch after SQL
completion. Until then the new ingress fails closed, not back to the unsafe legacy
path. No live webhook credentials, OpenAI key, payments or WhatsApp sends are needed.

## Verification and remaining gates

See [verification results](existing-development-verification.md) for exact current
test counts and environment. The disposable runner uses the first six unchanged
repository files followed by the manual Phase 8 replacement, in two fresh synthetic
databases, including existing-workspace/history/catalog backfill. Its platform
fixture intentionally has a different schema and two policies/FK; it is not a
claim to reproduce the unknown hosted administration schema.

The original conflicting Phase 8 installer is retained only as historical source.
No historical migration was edited or remotely applied. After a committed change,
recover through a separately reviewed forward migration; never drop platform tables,
rename their catalog, disable guards, restore legacy ingress execution or replay
an installer. If Phase 8 of either variant was already applied, stop: this installer
is not an upgrade between variants. Resolve the baseline with a targeted forward fix.

Real Supabase Auth/PostgREST/SSR and authenticated browser workflows remain separate
tests. No hosted integration success, automatic merge or deployment is claimed.
