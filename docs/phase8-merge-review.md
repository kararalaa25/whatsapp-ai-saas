# Phase 8 merge preparation review

## Verified branch state

Remote heads were fetched explicitly before review:

- `main`: `7f8cb2014185dd9275f0145929fe200b961b9849` (Phase 7B).
- `feature/phase-8-subscriptions`: `ed124c17a6acaea3d07ce2260a5da586272a9156` at review start.
- `git rev-list --left-right --count origin/main...origin/feature/phase-8-subscriptions`: `0 1`.

The feature worktree was clean at review start. The original checkout's interrupted
untracked work was not changed. Review corrections and this report are an additional
feature-branch commit; main is not modified. No automatic merge is authorized here.

## Review findings and correction

### Corrected: nullable access must deny capacity

The pending Phase 8 `subscription_limit` helper previously used
`IF NOT subscription_access(s)`. A `past_due` row without `grace_ends_at` is allowed
by the table definition, and `subscription_access` returns SQL NULL for it. In
PL/pgSQL `IF NOT NULL` does not enter the rejection branch, so product/FAQ/number/
member additions could retain a positive capacity while the dashboard and AI
reservation path denied access. Current trusted transitions set a grace deadline,
and clients cannot write subscription rows, so this was a defensive fail-closed
inconsistency rather than a demonstrated owner upgrade path.

The helper now uses `IS NOT TRUE`, denying both false and unknown access. The
unapplied Phase 8 file alone was corrected; Phase 7A/7B and earlier migration files
were not changed. A source-contract regression and the existing null-grace UI
boundary check cover intent. Actual PostgreSQL/trigger evaluation is still untested.
The preflight now inventories all four allocated capacity types, including inactive
catalog entries and disabled numbers, against initial trial defaults.

### Blocking review item: new-customer ingress at quota/expiry

The Phase 8 conversation meter intentionally raises `54000` when a new test-customer
conversation exceeds the monthly quota or effective subscription access expires.
The Phase 5B ingestor first inserts the authoritative inbound row and then inserts/
upserts its conversation in the same RPC transaction. Consequently, that exception
rolls back the inbound row as well as the new conversation. The unchanged webhook
route responds with 503; sequential batch processing stops at that event. Repeated
rejection can delay later events in the same batch. Existing-customer upserts follow
the UPDATE branch and do not consume another conversation unit; existing history
is not deleted.

This is a code-path finding, **not a live PostgreSQL reproduction**. Before merge,
reviewers must resolve or explicitly accept the ingress policy and verify it with
synthetic new/existing customers, exhausted quota, expired trials, batched events
and provider retries. If verified inbound must always be retained, implement a
separate durable over-limit intake/reprocessing policy before activation; merely
returning 200 after dropping an event or swallowing the quota error is unsafe.
No such behavior change or provider interaction was made during this review.

## Reviewed security and integration boundaries

- Workspace selection, claims checks, owner lookup and membership RLS helpers are
  unchanged from main. Billing reuses `requireAgentOwner`; its public SQL RPCs
  independently check the authenticated workspace owner.
- AI generation still uses server-loaded saved settings and tenant-filtered history/
  knowledge. Provider requests require the UI-observed conversation revision; stale
  or missing revisions fail before reservation/provider dispatch. Studio and Inbox
  share the DB conversation/revision operation key. A duplicate false result denies
  another call, including cross-surface retries.
- The monthly reservation and original per-owner daily preview cap execute together
  in one RPC transaction. Phase 7A attempt-rate limits are preserved. Reservations
  retained after ambiguous provider failures are potential usage, not confirmed
  successful generations or charges. Recovery requires reconciliation rather than
  blindly freeing quota; conservative reservations can block further use of that
  revision even after rollover.
- All new tables enable RLS. Central plan definitions are intentionally readable by
  authenticated users; subscription rows are owner-scoped. Private counters,
  reservations, audit, invoices and payment events have no client data grants.
  Public RPCs explicitly revoke default execution before narrow grants. Private
  helpers/transitions have no PUBLIC/anon/authenticated/service-role execution.
  Static review found no new cross-tenant policy or unintended client write grant.
- Definer functions have an empty search path and fixed qualified relations.
  Their actual owner, installed ACLs, default-privilege effects and behavior under
  impersonated roles remain live-database checks. Keep `workspace_private` outside
  the exposed API schemas; definer ownership is a trusted administrator boundary.
- Existing tenants receive one trial at eventual migration application. Current
  records above trial capacity are retained and can be edited/read under original
  access rules; additions are blocked. In-place UPDATEs do not recheck capacity;
  tenant reassignment is denied. Initial owner creation depends on transactional
  subscription initialization before membership insertion. Verify trigger ordering,
  count visibility and locking on PostgreSQL rather than relying on mocks.
- All tenants' trials eventually expire, while paid activation/renewal remain disabled.
  Applying this preview can therefore stop new usage without a customer payment
  recovery path. Review the activation/backfill policy before applying anything.
- The ingress wrapper moves the unchanged old function to the private schema,
  retains only the public verified-ingress service-role grant, and locks workspace
  before conversation writes. Signature verification, test-number mapping and
  outbound hard stops remain unchanged. Verify the entire trigger/lock chain,
  function identity/schema change, duplicate upserts and deadlock behavior live.
- Phase 7B settings/run guards are installed conditionally when its tables exist.
  They enforce automation access on writes, allow disabling, and preserve the
  pending-human transition. Draft completion is rechecked. Trial/Pro/Business
  support the existing simulator; Starter does not. No live automation or outbound
  sending is enabled. Existing expired/downgraded configurations must be tested.
- Public billing acceptance remains unconditionally disabled; no billing webhook,
  payment credential, checkout or event-to-entitlement activation exists. No public
  subscription upgrade mutation was introduced.

## Pending migrations and required order

No migration or preflight/postflight SQL was executed. The recommended pending
chain is:

1. Existing foundation through knowledge/catalog (`000000` through `030000`),
   verifying actual migration history rather than assuming application state.
2. `supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql` (Phase 7A, pending).
3. `supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql` (Phase 7B, pending).
4. `supabase/migrations/20261114180000_phase8_subscriptions.sql` (Phase 8, pending).

`docs/sql/phase8-preflight.sql` and `docs/sql/phase8-postflight.sql` are read-only
review scripts, not tests of writes, impersonation, triggers or races. If Phase 8
is applied before Phase 7B, its optional automation guards will not be installed;
a separately reviewed follow-up migration must add them before automation is used.
Do not replay an applied Phase 8 migration to install them.

## Validation performed on the reviewed feature branch

- `npm test`: **199 passed, 0 failed**.
- `npm run lint`: exit 0; no errors, one pre-existing `_cacheHeaders` unused-variable
  warning at `src/utils/supabase/server.ts:15` (unchanged).
- `npx --no-install tsc --noEmit`: exit 0.
- `npm run build`: exit 0, production compilation and page generation passed.
- `git diff --check`: passed.
- Offline pglast 8.8 parsing: migration accepted (59 SQL statements, 14 PL/pgSQL
  bodies); preflight 11 and postflight 12 SQL statements accepted. No SQL execution.

The suite includes mocked action/provider behavior, rendered React states,
source-contract assertions and a serialized in-memory concurrency model. It does
**not** install or execute the new database functions. Passing it does not prove
PostgreSQL name binding, transaction isolation, race safety, RLS, trigger execution,
Supabase schema-cache behavior or authenticated browser behavior.

## Merge gate and PR disposition

Open as a **draft PR** for review; do not merge automatically. Before marking ready:

1. Resolve/accept the new-customer ingress policy above and validate batch/retry
   behavior without losing verified events.
2. Obtain separate authorization for disposable PostgreSQL verification of the full
   pending chain. Exercise owner A/B/member/anon/service-role access, direct RPC/
   table/sequence privileges, NULL/expired grace, workspace creation/backfill,
   simultaneous capacity inserts, last-unit and same-key reservations, original
   abuse-cap rollback, monthly rollover, paid-upgrade rejection, private invoices/
   events and Phase 7A/7B lock/trigger interactions.
3. Complete authenticated browser checks for owner/member/foreign tenant, missing
   schema, retained over-limit history and English/Arabic responsive states.
4. Recheck remote main and retest after any further integration changes.

No migrations, credentials, deployments, payments, WhatsApp sends or production
changes were performed to prepare this PR.
