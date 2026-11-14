# Phase 8 — subscriptions, entitlements and billing architecture

## Safety and delivery

Branch: `feature/phase-8-subscriptions`. Initially based on stable main
`0ae4649dcf2874178d3a5f44d8c015af954f31b2` (Phase 7A).
The original `/workspace/whatsapp-ai-saas` checkout contained untracked auth,
dashboard, proxy and Supabase utilities; they were preserved without modification.
Implementation uses `/workspace/wasla-phase8`, a separate worktree.

No migration, preflight or postflight script was executed against a database.
No deployment, payment, provider request, credentials or WhatsApp send was used.
The billing adapter rejects every event. There is no billing webhook or checkout.

## Central plans and authorization

`public.subscription_plans` is the single configuration source for Free Trial,
Starter, Pro and Business. All prices are explicitly provisional and unconfigured
(NULL), with IQD/USD monthly/annual slots. Configured prices use ISO minor units
(IQD 1/1000; USD 1/100); never floating-point provider amounts. No final prices
or artificial commercial discounts are supplied. Quotas are provisional technical
defaults and do not override the older security caps.

Only a trusted database administrator may configure plans or operate private
subscription transitions. Authenticated owners have SELECT plus two narrow RPCs:
owner-scoped dashboard reads and fixed-unit AI reservations. They cannot write
subscriptions, plans, invoices, events, counters or audit records, or submit a
price, amount, date, role, unit count or paid plan to a mutation endpoint.
All new tables have RLS, including private tables. `workspace_private` must remain
outside exposed API schemas. Public definer RPCs explicitly check owner access,
have an empty search path, and revoke default PUBLIC/anon/service-role execution.
The verified-ingress wrapper alone retains its original service-role execution grant.
Private trigger functions and helpers have no client execution grants.

Each existing workspace receives one 14-day trial **only when the migration is
later applied**. New workspaces initialize subscriptions transactionally. Missing
schema is never interpreted as an active plan, and real AI generation fails closed.
No recurring reset, trial restart action, paid seed, payment verifier or billing
write service role is provisioned.

## State, grace and downgrades

Stored states: trialing, active, past_due, canceled and expired. Effective access
also checks DB time: trial deadline, paid period end, or fixed grace deadline.
Expired stored trials therefore lose new usage without needing a scheduler.
The UI shows effective expiration; historical status remains available for audit.
Canceled subscriptions retain access until the original period end. Past-due
access is bounded by the configured grace days, anchored to the period end.
Repeating past_due cannot extend grace.

`workspace_private.transition_subscription` is operator-only, uses an expected
revision, locks the workspace/subscription, validates transitions and records a
reason plus before/after state. It permits cancellation, expiration, past-due from
an ended active period, and a lower-plan choice with those transitions. It never
extends a trial or paid period. Active paid activation, renewal and past-due
recovery are deliberately rejected pending verified payment processing. Normal
self-service upgrades/downgrades are disabled previews, not successful mutations.

Capacity checks apply to additions; existing products/FAQs, memberships, numbers,
conversations, drafts and historical data are never deleted to fit a plan.
Over-limit edits, reads, local review/discard and removals retain their original
authorization rules. New drafts require the applicable plan feature and effective
access. Disabled numbers count toward total allocated capacity, avoiding re-enable
bypasses. Existing data is not retroactively backfilled into monthly metering.

## Metering and retries

The private ledger uses fixed UTC calendar months, including annual subscriptions
(annual billing does not create a year-long usage bucket). Periods are bounded to
at most 32 days. Atomic updates require `used < maximum`; workspace locks serialize
reservations, capacity additions and trusted subscription changes. A unique
workspace/metric/operation key persists across period boundaries.

Real AI provider reservations use the DB-validated conversation ID and revision.
Studio and Inbox share the key, preventing cross-entry-point retries. Only a fresh
reservation calls the original `reserve_ai_preview` in the **same transaction**;
its per-owner 50/day cap remains in force across workspaces. A duplicate returns
false and the server refuses a second provider call. Errors roll back quota and
ledger together. Phase 7A attempt-rate caps (6/minute, 100/day) remain in place;
those abuse counters intentionally count attempts, even rejected retries.

A committed reservation means authorized potential provider usage, not a confirmed
successful response or a charge. Failed/ambiguous calls and failed draft saves keep
the reservation; no automatic release risks repeated provider consumption. The
same revision cannot be blindly retried, even next month. Refresh/reconcile first;
a future retry/reconciliation workflow must distinguish definitive non-dispatch
from ambiguous provider outcomes before authorizing a new operation. Exactly-once
external provider execution is not claimed.

Simulated demo and Phase 7B draft automation do not consume AI provider units.
WhatsApp metering currently counts **new test-customer conversation rows**, not
messages, live traffic, or each active customer each month. `AFTER INSERT` metering
avoids counting the existing-customer ON CONFLICT UPDATE path. The test metric is
explicitly labeled separately. New rows after quota/expiration fail transactionally;
existing customer history and ingestion into existing conversations remain intact.
No live WhatsApp channel is enabled by this work.

The ingress wrapper preserves the existing verified test ingestor, moving its
implementation into the private schema and locking workspace before conversation
writes. Signature verification and trusted number mapping remain upstream. This
must be exercised with the full pending trigger chain in a disposable DB.

## Owner dashboard

`/dashboard/billing?workspace=<uuid>` supports English; add `&lang=ar` for Arabic
and RTL. It reuses verified workspace owner access. It shows plan, effective state,
trial/access dates, interval/currency, UTC monthly usage, capacity and 80%/100%
warnings, four-plan monthly/annual comparisons, disabled change controls and
billing-history placeholders. Dates display in Asia/Baghdad. No private invoice,
payment event, provider payload or secret reaches a browser. Missing storage and
owner denial render safe unavailable states. Layout has responsive grids and
native disabled controls, with no payment-success UI.

## Future payment verification contract

`src/utils/billing/provider.ts` defines provider-neutral money, invoices, events,
verification, reconciliation, cancellation and refund interfaces. The private
invoice table snapshots workspace, plan version, subscription revision, currency,
amount and period. Events reference tenant-composite invoices and have a unique
(provider,event_id) key, payload hash, verification and processing timestamps.
No adapter or event-to-entitlement consumer is implemented or enabled.

A future adapter must verify signature against **raw bytes before parsing**, use
constant-time verification, reject stale/replayed timestamps, verify merchant,
environment and authoritative provider transaction, and compare invoice amount,
currency, plan/version and subscription revision against server records. Never
trust a client price, redirect or purported success message. After verification,
lock invoice and subscription, insert/deduplicate event, reconcile out-of-order
facts, transition once and mark processed in one transaction. Repeated identical
events are no-ops; reused IDs with a different hash are rejected. Failures must
roll back the entire transaction. Renewal extends only the verified invoice term;
cancellation never erases history; refunds require original transaction linkage,
amount bounds and separate idempotency keys. Partial refunds must not implicitly
grant or reset entitlements. No unsigned webhook is acceptable.

## Migration order and integration

New migration: `supabase/migrations/20261114180000_phase8_subscriptions.sql`.
Read-only checks: `docs/sql/phase8-preflight.sql` and
`docs/sql/phase8-postflight.sql`. They contain BEGIN READ ONLY / ROLLBACK and no
DDL/DML, but were **not run**. Execute only under a separately authorized DB review.

Required predecessors, in order: workspace foundation `20261114000000`, WhatsApp
test foundation `20261114010000`, AI playground `20261114020000`, knowledge/catalog
`20261114030000`, and **pending** inbox `20261114040000`.
Never edit or replay applied migrations. Phase 8 is additive. The full numeric
filename is unique in the inspected repository. CLI generation was attempted but
the available CLI could not initialize under its read-only home; the migration
file was authored locally and parsed offline. Current Supabase RLS/function docs
were checked through the connected docs search (direct changelog fetch returned
403). No database advisor/query/apply/push commands were run.

Phase 7B landed concurrently on main as `7f8cb20` with pending migration
`20261114050000_whatsapp_automation_draft_engine.sql`. Integration details and final
verification are recorded below. Phase 7A and 7B remain unapplied.

## Verification and remaining database work

Automated checks include mocked owner/tenant denial, expiry and grace boundaries,
usage warnings, disabled provider ingestion, SQL ACL/RLS/locking invariants,
50 concurrent mocked identical reservations, cross-tenant operation keys, real
server-action duplicate-reservation/provider suppression and Arabic/English
rendered UI states. Existing regression mocks were updated to return the fresh
reservation boolean. They do not pretend that the new schema already exists.

SQL and PL/pgSQL were parsed offline with pglast 8.8, including read-only scripts.
Parsing is syntax checking, not migration execution, name binding or RLS proof.
Authenticated live browser testing remains pending because schema is unapplied;
UI checks render React with mocked owner/plan data and test denial/missing schema.

Before merge/activation, separately authorize a disposable PostgreSQL/Supabase
verification environment and test the complete pending chain with synthetic users:

1. Owner A / owner B / ordinary members / anonymous / service role: direct table
   and RPC reads/writes, forged tenant IDs, quota manipulation and paid upgrades.
2. Exact trial/grace expiration, active/canceled access boundaries, stale transition
   revisions, no repeated grace extension, terminal states and audit atomicity.
3. Concurrent same/different AI operations at last unit, monthly rollover, original
   daily abuse cap rollback, cross-surface retries and cross-tenant independence.
4. Concurrent product/FAQ/number/member additions at the cap, existing over-limit
   rows, tenant reassignment denial, edits/read access and safe downgrades.
5. Ingress replay/duplicate rows, existing-customer upserts, new-customer quota
   rollback, and workspace/conversation lock order with Phase 7A/7B triggers.
6. Private invoice/event grants and composite tenant FKs; forged callbacks must
   remain rejected. Future verified webhook processing requires separate tests.
7. Full authenticated desktop/mobile English/Arabic browser behavior, missing
   migrations, entitlement denial, retained history and all disabled payment flows.

No live PostgreSQL, real billing or live WhatsApp verification is claimed.

### Integration with merged Phase 7B

Phase 8 was rebased onto main `7f8cb2014185dd9275f0145929fe200b961b9849`
after Phase 7B landed during implementation. No main branch was checked out,
modified, pushed or merged into. No Phase 7A/7B migration was edited or executed.

Recommended pending order is Phase 7A `040000`, Phase 7B `050000`, then Phase 8
`180000`. Phase 8 conditionally installs database guards on Phase 7B settings and
run writes only if those tables exist; Phase 7A-only databases still parse/apply
without assuming Phase 7B. If Phase 7B is applied **after** Phase 8 instead, a new
reviewed follow-up migration must install the two optional triggers before any
automation feature is enabled. Do not replay Phase 8 or edit its applied version.
The preflight scripts identify schema/history for this decision.

Trial, Pro and Business permit Phase 7B's owner-operated **simulated draft-only**
automation; Starter does not. Both enablement and run insert/update enforce plan
access in the database, even via direct RPC. Disabling remains possible after
expiry; human-request handoff remains available. Expiration or downgrade after a
reservation blocks draft completion, preserving the run for review. No paid AI
quota is consumed by this simulator, and the Phase 7B outbound hard stop remains.
Automation errors now mention subscription entitlement checks. The roadmap was
updated to reflect this implemented Phase 8 scope.

Remaining integration blockers are live SQL/ACL/trigger/concurrency verification
and authenticated browser verification under the full unapplied migration chain.
Any further main changes before merge require another integration and full retest.

### Final local validation after Phase 7B integration

- `npm test`: **198 passed, 0 failed**, including Phase 7B regressions.
- `npm run lint`: passed, 0 errors; one pre-existing `_cacheHeaders` unused-variable
  warning in `src/utils/supabase/server.ts:15` (unchanged).
- `npx --no-install tsc --noEmit`: passed.
- `npm run build`: passed; billing and automation routes included.
- `git diff --check`: passed.
- Offline PostgreSQL parser: 59 SQL statements / 14 PL/pgSQL bodies accepted;
  preflight/postflight scripts also parsed. No database SQL was executed.

Provider actions now require the conversation revision observed in the owner UI.
A replay after a successful save or new inbound message cannot silently authorize
a fresh operation using a newer DB revision. Missing/stale revisions fail before
reservation/provider calls; concurrent requests for the same revision share the
persistent reservation key. Client revision values never authorize tenant access
or override database revision checks. Both Studio and Inbox call sites and mocked
regressions were updated.

The first local build attempt used a node_modules symlink that Turbopack rejected
outside its project root. Copying the existing installed dependencies into this
isolated worktree resolved it; no dependency versions or lockfiles were changed.
All final results above are from the integrated worktree with local dependencies.
