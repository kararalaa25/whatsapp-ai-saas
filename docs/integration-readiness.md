# Phase 8 / Phase 9 integration readiness

## Decision

**Ready for a human-reviewed development-project rehearsal, not verified for merge
or deployment.** The manual SQL Editor and local Terminal/browser procedures are
prepared. No hosted Supabase project was contacted, SQL executed, credential
configured, browser account provisioned, branch merged or deployment created.
PR #1 must remain draft/unmerged until real integration and operational gates close.

Start with [manual migration instructions](manual-supabase-migrations.md), then
[local Terminal and browser testing](local-supabase-testing.md). Required environment
variable names, exact SQL order, backup/forward-fix procedure, synthetic fixture
guidance and eventual Vercel prerequisites are in those documents.

## Provenance and branch review

Remote heads were fetched/rechecked on 2026-11-14:

| Branch | Reviewed head |
| --- | --- |
| `main` | `7f8cb2014185dd9275f0145929fe200b961b9849` |
| `feature/phase-8-subscriptions` | `e5f44b43d84dcfe5e49f66a8657132982339193e` |
| `verification/phase-9a` | `7bbb1d8fcda7110425feeb9595e9ecdbb4df105f` |
| `verification/phase-9b` | `90b4272618b95a1bbab0ba6e1049bced00b80a6b` |

New isolated worktree `/workspace/wasla-integration`, branch
`integration/phase8-supabase-readiness`, based on that Phase 9B head. Phase 9B is
six commits ahead/zero behind remote main and three ahead/zero behind Phase 8.
Main already contains Phase 7B application code; branch ancestry does not establish
database migration state. Phase 9A adds disposable verification evidence/harness;
Phase 9B adds blocked real-stack evidence/storage diagnosis, not new application SQL.
All existing worktrees/branches, including the original checkout's interrupted
untracked work, were preserved. No historical or pending migration was changed.

Reviewed: AGENTS.md, roadmap, Phase 7A/7B/8 docs, merge review, Phase 9A/9B evidence,
all seven SQL files, pre/postflights, Auth/SSR/workspace access, inbox/drafts,
automation, billing/reservations, webhook ingestion and outbound hard stops.
Supabase skills' security/RLS guidance and installed Next 16 documentation were
consulted. Public Supabase changelog/docs fetches returned HTTP 403 here; no current
hosted product behavior is inferred from that unavailable documentation.

## Migration assessment and compatibility

The first three migrations are **reported** applied to a prior test project in
`docs/ai-agent-preview.md`, despite stale unapplied headers. The fourth/catalog file
was delivered unapplied in Phase 6A with no authoritative later hosted confirmation.
The final three are documented pending. Every actual hosted state remains unknown.
Phase 9A applied the full chain to an isolated PG17.12 fixture twice and exercised
28 database cases plus nine route/SQL-bridge checks. Those historical results use
stub Auth, not real JWTs, GoTrue or PostgREST. They are not rerun or reclassified here.

Pending sequence once prerequisites are proven:

1. `supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql`
2. `supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql`
3. `supabase/migrations/20261114180000_phase8_subscriptions.sql`

A fresh dedicated project requires all seven in chronological order; an existing
target with absent/unverified catalog cannot proceed directly to 7A. New inventory
SQL tolerates missing objects/history and lists effective function/table/sequence
privileges, RLS, policies, owners, default ACLs and trigger definitions. New final
postflight adds subscription/automation/inbox completeness, intake projection and
queue invariants, plus all ten Phase 8 trigger identities. These are read-only
catalog/count checks, not hosted security tests. Existing phase-specific scripts
remain unchanged and must be run at the correct stage.

Static compatibility review found:

- Real Supabase `auth.users`, `auth.uid()`, standard API roles and an administrator
  capable of postgres ownership are prerequisites. No Auth tables are replaced.
  Administrator SQL Editor results cannot prove caller-specific RLS.
- Public feature data is RLS protected; member/owner checks use stored membership
  and real caller identity. Public RPC grants are explicit and authorization lives
  inside SQL. Private helpers/tables/sequences remain unexposed and deny client
  access; definer functions use empty search paths. Actual default ACLs, inherited
  privileges and PostgREST schema visibility must still be inspected on the target.
- 7A introduces owner-only workflow metadata over verified source history; closed
  conversation reopening preserves human takeover. Approval is local, not delivery.
  7B defaults disabled, uses revision-protected draft-only processing and rechecks
  human control before completion. New drafts cannot fabricate customer messages.
- 8 keeps existing daily/minute abuse caps and adds workspace subscriptions,
  monthly UTC quota reservations, capacity guards and bounded retained intake.
  The application uses `reserve_subscription_ai` before actual OpenAI generation;
  a successful prior reservation is not authorization for duplicate provider use.
  Simulated previews are distinguished from paid provider reservations. No provider
  key is configured by this branch.
- 8 is mandatory before exercising the Phase 8 application: missing storage fails
  closed. 7B must precede 8 in this integrated procedure so both conditional
  automation entitlement triggers exist. Applied 8 without 7B requires a new
  forward correction, not replay. Real PostgREST RPC/relationship visibility and
  cache refresh remain untested.
- Existing above-capacity data is retained; one trial is backfilled at application
  time. Trial expiry is effective by timestamp, even if stored status still says
  trialing. New customers can remain deferred after expiry with no paid recovery
  path. Operator recovery/trial policy, communications and owner acceptance must
  be decided before using this preview with business traffic.
- Verified ingress keeps service-role execution restricted to its server path,
  maps tenant from trusted connection, checks global source identity and retains
  quota/expiry-deferred events. Raw-only legacy ingress execution is revoked by 8.
  Queue capacity remains 1000 unresolved eligible texts/workspace; saturation
  returns 503 rather than false acknowledgment. No retention purge was added.

No runtime application or database defect was confirmed through the available
offline checks. This is not a claim that untested hosted integration has no defects.

## Confirmed tooling issue and changes

On this clean worktree, `npx --no-install tsc --noEmit` initially failed because
`LayoutProps` is a Next-generated global. Installed Next documentation confirms
that `next typegen`, dev or build must generate it first. Added
`npm run typecheck` → `next typegen && tsc --noEmit` and used it in the fresh-checkout
guide. The corrected command passed with prior generated output moved outside the
project; no shared checkout or TypeScript application code was altered.

Added a GET-only opt-in smoke tool with explicit dedicated-project acknowledgment,
exact origin validation, publishable-key restriction, no redirects, timeouts and
sanitized output. Real JWTs are checked with Auth `/user`; tenant SELECTs use the
actual token. Missing JWT/empty own fixtures are incomplete, not a successful test.
It intentionally does not exercise write/RPC/session-refresh paths. The acknowledgment
cannot prove an external project's isolation; an operator must independently do so.
Five fixture tests cover target refusal before networking, GET-only requests,
incomplete fixtures, tenant/member leaks and missing-schema/Auth failures.

## Validation in this preparation

Environment: Debian 13 Linux x86_64, Node 24.22.1, npm 11.9.0, Next 16.4.6;
isolated integration worktree; no Supabase/provider environment configured.
Dependencies were installed from the unchanged lockfile with scripts disabled.
The first install hit an unwritable default npm cache; a private `/tmp` cache
completed successfully. No dependency versions changed.

| Check | Result / scope |
| --- | --- |
| `npm test` | PASS: 217 tests, zero failures/skips (212 existing + 5 GET-tool fixture tests); mocks/source assertions remain mocks |
| `npm run typecheck` on freshly generated route types | PASS; initial plain-tsc prerequisite failure addressed as above |
| `npx --no-install tsc --noEmit` after generation | PASS |
| `npm run lint` | PASS: zero errors, one existing unused `_cacheHeaders` warning in Supabase server helper |
| `npm run build` | PASS: actual production Next build, including all feature routes; no schema/provider integration implied |
| Static SQL parsing (`pglast` 8.8) | PASS: seven migrations / 308 top-level statements; all ten docs/sql files / 104 statements; 42 PL/pgSQL function bodies parsed. No execution, binding, permissions or lock proof |
| GET-tool invocation with no target/env | PASS: blocked safely with exit 2; no network request |
| `git diff --check` | PASS |
| Remote SQL / real Auth/JWT/PostgREST / SSR / authenticated browser | NOT TESTED here; remain release gates |
| Local full Supabase stack | BLOCKED per Phase 9B Docker report; no new pull/start attempt |

The smoke tool's fixtures are not real Auth sessions. The manual browser checklist
has not been executed; no screenshots or traces are represented as new evidence.
No local application server connected to Supabase during preparation.

## Remaining gates before merge, deployment or a business pilot

1. Authorize/identify a dedicated development project; verify its schema baseline,
   backup/restore procedure and exact migration hashes. Resolve catalog uncertainty.
2. Apply the chain manually there, inspect actual ACLs/RLS/owners/triggers and
   schema cache, then exercise real Auth/JWT/PostgREST, SSR refresh/logout and
   tenant-specific RPC denials using synthetic owner A/B/member/anonymous contexts.
   `getClaims()` verifies access JWTs locally and is not immediate session revocation;
   record behavior until expiry and confirm refresh revocation explicitly.
3. Run the browser matrix: signup/confirmation/onboarding, inbox/assignment/takeover,
   stale/local-only drafts, draft-only automation, bilingual/mobile billing/intake,
   expired history, reconciliation bounds and cross-workspace denial. Prepare
   trusted synthetic inbox/member fixtures; empty lists are insufficient evidence.
4. Reconfirm concurrency/intake rollback/idempotency against the actual Supabase
   stack (Phase 9A evidence helps but does not replace hosted compatibility).
   Keep GET-only smoke scope distinct from privileged RPC/write testing.
5. Owner decisions: trial/backfill notice, expired-customer recovery with paid
   activation disabled, saturation alert thresholds/on-call response, finite upstream
   retry windows, audit access, retention/deletion/export policy and privacy/consent.
   Do not use entitlement overrides or deletion of acknowledged events as recovery.
6. Refresh main and retest before a separately reviewed merge. Authorize deployment
   and environment configuration independently. Review HTTPS Auth redirects, SSR
   cache headers, preview access and target isolation before any eventual Vercel use.

Payment acceptance still throws unconditionally. Both WhatsApp transport entry
points still throw, with no enabling env flag. No shared SQL, production data,
deployment, paid activation or WhatsApp send was accessed/performed in this work.
