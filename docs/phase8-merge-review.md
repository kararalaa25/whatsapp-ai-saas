# Phase 8 merge preparation review

## Branch and disposition

This retention fix starts at `23e3748d45562fa6d03d661f9c5413112784fea6` on
`feature/phase-8-subscriptions`, with main still
`7f8cb2014185dd9275f0145929fe200b961b9849` (Phase 7B). The worktree was clean.
Only the feature branch and PR #1 are updated. Main and the original interrupted
checkout are untouched. PR #1 remains draft and must not be merged automatically.

No migration, preflight or postflight SQL was executed. No credentials, provider
requests, deployment, payment activation or WhatsApp sending were performed.

## Resolved code blocker: subscription denial rolled back verified intake

Previously, the new-conversation quota trigger raised inside the same unprotected
transaction as raw-message insertion. Quota/expiry denial rolled back the verified
inbound row, and the webhook stopped processing the rest of its batch. That code
path has been replaced in the **unapplied Phase 8 migration**. No earlier migration
was edited, and no migration application or live PostgreSQL reproduction is claimed.

### Durable acceptance and entitlement-controlled projection

The existing public `ingest_whatsapp_ai_test_message` RPC is replaced **in place**,
retaining its signature and service-role-only execution. It resolves the workspace
from the trusted test connection mapping and locks the workspace before connection,
intake and conversation changes. The caller never supplies a tenant or price.

It inserts/deduplicates `whatsapp_inbound_messages` first. Eligible text with a
sender gets a private intake record referencing that authoritative row. Processing
then occurs inside a PL/pgSQL exception subtransaction. A conversation-quota error
rolls back only projection, conversation state and usage changes; the raw message
and intake record survive. Other catchable processing errors similarly preserve
the raw message, with a sanitized failure code and bounded failure count. Successful
projection still creates only a verified `customer` message, never an AI reply.

Quota/expiry denial returns `deferred`, which the server adapter recognizes as
**durable acceptance**. A 200 response for in-scope message events means the RPC
committed an inserted message, an already persisted exact duplicate, or a retained
deferred event. An ambiguous/unrecognized RPC result, storage error or overflow
returns 503, not a false success. Status-only events, unallowlisted phone IDs and
unmapped phone/WABA pairs retain their explicit out-of-scope ignore behavior; they
are not reported as accepted customer messages.

Provider message IDs remain globally unique. Duplicate IDs are checked against
tenant, connection, message type, text and provider timestamp; intake sender or
existing projected-customer identity is checked when supplied. A foreign/colliding
identity fails rather than acknowledging another tenant's row. Replayed deferred
messages return duplicate without processing, changing counters or consuming retry
budgets. Old already-projected Phase 5B rows need no intake backfill. Old retained
but unprojected text can enroll when replayed with a trusted sender; no bulk or
fabricated historical-message backfill is run.

Mapped disabled test connections retain verified events but defer projection until
a trusted administrator reactivates the mapping. Unknown mappings are still ignored.
Unsupported/senderless events retain their original minimal raw representation and
cannot create customer conversations. No contact profiles, payload envelopes,
media, credentials or duplicate body copies enter the new intake table.

### Bounded over-limit state and explicit backpressure

`workspace_private.whatsapp_intake` stores source/connection references, sender ID,
status, reason, failure count and timing metadata. All tables and its identity
sequence deny client access; all tables enable RLS. Tenant-composite FKs and
explicit tenant/connection joins protect reads/projection. Accepted order is a
private monotonic identity assigned under the workspace lock, rather than an
untrusted provider timestamp or a transaction-start timestamp. An unresolved
predecessor blocks newer projection for the same customer, not other customers.

At most **1000 unresolved eligible text events per workspace** may be retained in
this deferred state. The capacity decision occurs **after** projection: even with
1000 outstanding events, an existing customer's processable message can commit
without occupying a new unresolved slot. If an event still requires a 1001st slot,
the entire acceptance of that event fails, its raw/queue inserts roll back, and the
webhook returns 503. No acknowledged event is evicted, silently dropped or expired.
This is deliberate storage backpressure, not a promise of unlimited intake. Source
history and compact processed metadata remain durable; no destructive cleanup job
is installed. Retention/deletion policy still needs a separately reviewed milestone.

At hard capacity or during a storage outage, upstream events still depend on the
provider's finite retry window. Before activation, operators must review capacity,
monitor backlog/failed counts and provide a saturation response/runbook. This
operational limit is **not** presented as lossless unlimited storage.

### Batch progress even when one acceptance fails

`deliverMessages` now attempts every allowlisted event independently. It records
whether any acceptance failed and throws a generic aggregate failure only after
later events were attempted. Thus a saturated tenant/customer or transient fault
cannot permanently starve a later processable event in that batch. The overall
response remains 503 if any in-scope event was unpersisted; successful events remain
committed and deduplicate when the provider retries the whole batch. No message
body, provider exception or tenant identity appears in the failure response.

### Owner-only inspection and reconciliation

`/dashboard/intake?workspace=<uuid>` is linked from the inbox and supports bilingual
English/Arabic labels, direction-aware message bodies, masked customer suffixes
and 25-row pages. It remains accessible to the workspace owner after expiry.
`get_whatsapp_intake` checks ownership in SQL and returns only that tenant's
outstanding rows and bounded counts. Raw tables retain their prior access policies;
no new member/client data grant is added.

`reconcile_whatsapp_intake` independently verifies ownership, locks the workspace,
and processes at most **25 eligible rows per invocation**, at most **once per
minute** per workspace. Deferred/faulted events wait **5 minutes** between attempts.
The workspace lock and source-message uniqueness serialize webhook/reconciliation
races. Catchable processing faults are capped at **5 failures per event**. Quota,
predecessor and disabled-connection deferrals do not exhaust that fault budget.
After five faults the record remains retained for a trusted administrator to
diagnose; there is no public attempt-reset or subscription-override API. Resolving
such records requires separately authorized corrective administrator work.

Reconciliation reuses the same protected projection helper. It cannot mark events
processed without an authoritative existing/inserted `ai_messages` row. Creating a
new conversation still invokes the unchanged Phase 8 atomic monthly meter and
effective subscription checks. Rollover can permit a still-eligible workspace to
process backlog; an expired trial cannot recover new-conversation entitlement just
by waiting or retrying. Existing customer history may continue to append even after
expiry; Phase 7A reopening/human-control triggers still apply. New drafts, AI
provider calls and automation remain separately entitlement-controlled. Neither
reconciliation nor retention invokes an AI provider, automation engine or transport.

The old raw-only `ingest_whatsapp_test_message` service-role grant is revoked by
Phase 8 to close the alternate intake path. Existing application ingestion already
uses the Phase 5B RPC; no application caller uses the retired raw-only RPC. Verify
external compatibility before application. Private processing has no client or
service-role execute grant; owner APIs use the request-scoped authenticated client,
never the ingestion credential. All new functions use an empty search path.

## Trial backfill, capacity and billing review

Existing tenants still receive one configurable trial only at eventual migration
application. There is no retry-triggered trial reset, migration replay policy or
bulk paid seed. Current data above trial capacity remains readable/editable under
existing access rules; additions retain strict caps. Trial expiry blocks new billed
usage/feature processing while verified inbound acceptance and owner backlog
inspection remain available subject to the separate intake safety capacity.

Paid activation, renewals and recovery to paid active state remain disabled. Before
applying this preview, review the trial duration/backfill policy and the fact that
new customer conversations can remain deferred after trials expire without a paid
recovery path. Reconciliation never changes subscription state, period, price or
entitlements. No rollout or trial-extension mechanism is silently provisioned.

The prior nullable-capacity fix remains: `subscription_access(s) IS NOT TRUE`
returns zero capacity for false **or SQL NULL** access, including past_due with a
missing grace deadline. Its actual DB evaluation remains a live verification gate.

## Other security boundaries reviewed

Workspace/claims/owner helpers, existing RLS policies and signature/raw-body
verification are unchanged. Client-supplied workspace IDs in webhook payloads do
not route events. New private intake tables/sequence have explicit revoked grants;
public intake reads/reconciliation recheck owner identity. Static review found no
new cross-tenant policy or unintended client data mutation grant. Actual object
owners/default ACLs and impersonation behavior still require live verification.

AI reservations still require the UI-observed revision and a fresh shared
conversation/revision key. Original daily abuse caps and Phase 7A attempt limits
remain. Ambiguous provider failures retain conservative reservations rather than
risk duplicate provider usage. Billing acceptance and outbound transport remain
unconditionally disabled. Phase 7B conditional settings/run guards still enforce
plan access, with disable and pending-human paths preserved.

## Pending migrations and required order

1. Verify actual foundation/WhatsApp/playground/knowledge migration history through
   `20261114030000`; do not assume database state.
2. Phase 7A: `supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql` — pending.
3. Phase 7B: `supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql` — pending.
4. Phase 8: `supabase/migrations/20261114180000_phase8_subscriptions.sql` — pending,
   now includes retention/reconciliation in the same unapplied file.

No migration/preflight/postflight was executed. Read-only scripts:
`docs/sql/phase8-preflight.sql`, `docs/sql/phase8-postflight.sql`. They inventory
capacity, intake ownership/grants and backlog invariants without write tests.
If Phase 8 is applied without Phase 7B, its optional automation guards are skipped;
a new reviewed follow-up migration must install them before automation use. Never
replay an applied migration to install skipped guards.

## Validation and remaining merge gates

Final local checks for this retention fix:

- `npm test`: **212 passed, 0 failed**.
- `npx --no-install tsc --noEmit`: passed.
- `npm run lint`: passed, no errors; one unchanged `_cacheHeaders` warning in
  `src/utils/supabase/server.ts:15`.
- `npm run build`: passed, including the new owner intake route.
- `git diff --check`: passed.
- Offline PostgreSQL parsing accepted 80 SQL statements / 17 PL/pgSQL bodies;
  preflight 11 and postflight 15 statements also parsed. Parsing does not execute
  SQL or validate live table/function binding.

New regressions run the real webhook route, signature code, ingestion adapter and
owner actions against an explicit contract model. They cover quota/expired intake,
existing/new customers, tenant-independent batches, storage/full-queue failures,
retry/duplicate storms, owner denial, identity collisions, disabled connections,
ordered backlog recovery, bounded retries and simulated period rollover. SQL
source assertions check protection boundaries and ACL intent. These mocks do
**not** prove PostgreSQL security, transaction semantics, lock order or concurrency.

Before merge/activation, separately authorize disposable live PostgreSQL verification:

1. Apply the full pending chain only in that separately authorized environment;
   inspect object owners, RLS, sequence/table/function/default ACLs and schema cache.
   Test owner A/B, members, anonymous, service role and foreign IDs directly.
2. Exhaust quota/expire trials, ingest synthetic new and existing customers, and
   inject projection failures. Verify raw/intake commits, rolled-back projection/
   usage, exact duplicate and collision behavior, and unchanged handoff triggers.
3. Race webhook vs webhook vs reconciliation at last conversation unit, at 1000
   outstanding records, across workspace/customer boundaries and UTC rollover.
   Check intake identity ordering, failed-predecessor fairness, source uniqueness,
   closed-thread reopening and workspace/connection/conversation lock ordering.
4. Verify 25-row/one-minute/five-minute/five-failure bounds, full-capacity 503,
   success-only durable acknowledgments, whole-batch retry with committed later
   events, and operator recovery without deleting acknowledged messages or granting
   subscription entitlement. Review the provider retry-window/saturation runbook.
5. Verify trial backfill/onboarding trigger order, over-capacity edits, NULL/expired
   grace, original AI abuse-cap rollback, unauthorized upgrades and paid hard stops.
6. Complete authenticated responsive browser tests: expired owner intake inspection,
   paging/reconciliation/cooldown/review-needed states, non-owner/foreign denial,
   missing schema, bilingual text and retained history. No browser verification
   against an applied schema is claimed.
7. Refresh main and retest after any further integration changes.

The code-level quota-retention/batch-starvation blocker is addressed. PR #1 remains
**draft** pending these PostgreSQL/browser and operational acceptance gates; no
automatic merge or activation is performed.
