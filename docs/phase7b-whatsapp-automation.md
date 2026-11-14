# Phase 7B — WhatsApp draft automation and safe outbound contracts

## Delivered behavior

From a selected workspace, open **Automation → Configure draft automation**.
Only a workspace owner can read settings/audit or change preferences. Settings
start **disabled**. Supported modes are `disabled` and `draft_only`; `auto_reply`
is rejected by both application validation and database constraints. The page
shows auto-reply as unavailable and has no control that can activate delivery.

Owners can save response language (`auto`, Arabic, English), bounded business
rules, an IANA time zone, working days and a same-day working window. Start is
inclusive, end exclusive; an end time of 00:00 means the end of that day. Public
holidays and staffing are not inferred. Hours restrict generation, not human
review or manual drafting, and do not promise a response time. Customer requests
for a human take precedence over working hours and enabled agent settings.

In a selected inbox conversation, **Run draft-only automation** processes the
latest persisted verified inbound text. This is an owner-operated engine in this
phase: it is deliberately not invoked automatically by the webhook. Ingestion
credentials retain only their existing signature-verified persistence capability;
they cannot read settings, reserve automation or generate drafts. No new worker,
scheduler, background task, polling loop or delivery queue is activated.

The engine reuses the Phase 7A verified inbox reader and Phase 6B tenant knowledge
retrieval, catalog/FAQ/policy context and saved agent configuration. This phase
explicitly selects the existing grounded **simulator**, not an external model.
It demonstrates exact recorded price/currency, unknown stock or price, unknown
products, uncertain variants, delivery clarification and Arabic/English support.
Retrieved FAQs/policies and owner rules are included in the grounded prompt and
review references; the simulator does not interpret arbitrary FAQ/policy/rule
prose. It cannot establish general model-answer quality. No Meta, OpenAI or
payment credentials were configured, and no real provider call was made.
Existing separately chosen Phase 6B/7A preview capabilities are unchanged.

Generated content is stored in `whatsapp_reply_drafts` with provider `demo`,
never as a delivered/customer message. Owners review/edit/approve/discard using
Phase 7A. Local approval remains **NOT SENT**, with no delivery record or event.
Manual drafting and existing previews are independent of automation mode;
disabling automation blocks this engine, not owner-written customer support.

## Trusted input, authorization and privacy

- The action accepts workspace and conversation IDs only, never customer text,
  customer identity, connection mapping, knowledge facts, provider selection or
  a request to send. It rechecks the authenticated owner on each call.
- The existing webhook verifies the raw-body Meta HMAC before decoding/parsing,
  applies the existing test-number allowlist and calls the unchanged ingress RPC.
  Administrator-managed phone/WABA mappings resolve the tenant/connection; global
  Meta ID uniqueness and unique inbound references deduplicate ingestion.
- The reader and reservation RPC independently require `role=user`,
  `provider=customer`, a linked persisted inbound source in the same workspace
  and connection, text type and identical body. Playground/manual/assistant
  rows cannot trigger automation. Disabled/non-test connections are rejected.
- Public settings, run and audit tables are postgres-owned and RLS-enabled.
  Authenticated owners have SELECT only; direct DML and service-role/anonymous
  access are revoked. Narrow mutation RPCs validate owner access under locks,
  have empty `search_path`, and explicitly revoke PUBLIC/anon/service-role
  execution. Private helpers/triggers have no client EXECUTE grants.
- Workspace/conversation/connection/source/draft relationships use tenant
  composite foreign keys. User-editable JWT metadata never authorizes an action.
  Existing raw inbound member access from earlier phases is not expanded.
- History includes only verified customer turns, bounded to 12 messages and
  12,000 characters. The question/history are redacted before retrieval and
  simulation. Retrieval retains Phase 6B's eight-entry/10,000-character limit.
  Prior unsent assistant drafts never establish prices, commitments or actions.
- Audit records contain actor, event, tenant, source ID, settings revision and
  time, without duplicated customer body/contact/phone data. Runs contain source
  links, revisions and an owner-only agent snapshot for exact change detection.
  Existing source transcripts and local drafts remain personal data. Production
  retention/deletion and administrator access policy still require review.

## Concurrency, idempotency and failure behavior

Reservation and completion use Phase 7A's workspace-then-conversation lock order.
They validate the latest verified source position, conversation revision, inbox
state revision, automation settings revision and active test connection. Completion
also compares the saved enabled agent row and revalidates knowledge references
through the existing draft RPC. Workflow changes followed by reversal still
increment revisions and invalidate in-flight work. A new inbound message,
settings save, human takeover, close/reopen, or competing draft causes rejection.
Owner authorization is checked again at completion, so access revocation fails
closed. Database time enforces working hours independently of the application.

The run ledger's primary key `(workspace_id, source_message_id)` permits one
successful automation draft per source, including after a draft is discarded.
Simultaneous processing cannot produce two automation drafts. The existing partial
unique draft index also prevents competition with active manual/preview drafts.
Exact successful completion retries return the same local draft ID and never
approve or deliver it. No provider/network operation occurs inside a transaction.

A generating reservation expires after five minutes. A failed retrieval/generation
or stale completion leaves that reservation as `generating`; expiry is derived
from its timestamp rather than writing raw error details/customer content. Owners
may explicitly retry after expiry, with at most three attempts per source. Each
retry replaces the token so a late previous attempt cannot complete. There is no
automatic retry worker. Completed/handoff runs are terminal for that source.

Reservations share Phase 7A's atomic **6/minute and 100/UTC-day per-owner** limit
across workspaces. Failed/stale attempts consume reserved quota. Existing 100-draft
per-conversation cap remains. Repeated runs during a lease or after success are
rejected before consuming another reservation. Settings use revision conflict
protection. Read/WAF and general settings-request abuse controls remain platform
hardening work rather than an outbound activation mechanism.

Human request routing uses conservative Arabic/English keywords, not complete
language understanding. The reservation transaction moves the inbox to
`pending_human` with takeover enabled, records a handoff audit event, and creates
no draft. It never claims to transfer, notify or contact anyone. Existing human
control blocks generation until the owner explicitly releases it; releasing a
handoff does not reprocess its already handled source.

## Hard-disabled official transport and future lifecycle

`src/utils/automation/transport.ts` exposes the official Meta transport interface,
but its only implementation **always throws before inspecting input**. It accepts
no access token or injected HTTP client, reads no credential/enable flag and
contains no HTTP request implementation. `outboundEnabled` is the literal false;
no owner setting, environment variable, approval or database row changes it.
The older `sendTestReply` unconditional hard stop remains unchanged.

`lifecycle.ts` provides pure, non-persisting contracts only:

| State | Meaning |
| --- | --- |
| draft | Local unsent candidate |
| approved | Local review only; delivery is null |
| discarded | Local candidate withdrawn |
| queued | Future durable outbound intent; no queue exists here |
| sending | Future leased transport attempt |
| sent | Future verified Meta acceptance/status identity |
| delivered | Future verified customer-device delivery status |
| read | Future verified read status |
| failed | Future known failure; never inferred from local approval |
| unknown | Future ambiguous acceptance requiring reconciliation |

Before a future enqueue, recheck ownership, tenant/connection mapping, approval
revision, source freshness, human control, knowledge, consent/policy requirements
and the independent activation gate. Enforce the applicable customer-service
window and approved-template requirements for business-initiated messages; do
not assume a plain-text reply is always allowed. Use `deliveryKey(workspace, connection,
draft, revision)` with an atomic durable unique constraint; retry the same intent
with the same key. A key is an internal deduplication contract, not a claim that
Meta provides exactly-once HTTP delivery. Never blindly replay an ambiguous
network timeout: reconcile first, otherwise stop for review. Known transient
failures use bounded exponential delay (maximum five attempts); permanent errors
stop. No retry plan in this phase executes or schedules anything.

Future status ingestion must verify signature, event deduplication, provider
message ID, workspace/connection mapping and event authenticity before using the
pure status reducer. Delivered/read progress does not regress on old callbacks;
known failure after sent is retained against an old sent callback. A verified
later delivered/read receipt can resolve a failure. Current status-only webhook
behavior remains unchanged and does not fabricate delivery receipts.

## Migration delivery and application order

**No migrations or SQL were executed against any database.**
Phase 7A `20261114040000_whatsapp_conversation_inbox.sql` remains unapplied.
New review-only migration:
`supabase/migrations/20261114050000_whatsapp_automation_draft_engine.sql`.
No prior migration was modified. The new file creates three tables, indexes,
owner RPCs, private helpers and a settings-initialization trigger; it initializes
only disabled settings for existing workspaces. New workspaces also start disabled.
It does not backfill messages/drafts/runs or create outbound infrastructure.

Apply only later, in a separately authorized environment, in this order:

1. Existing workspace foundation `20261114000000`.
2. WhatsApp test foundation `20261114010000`.
3. AI/playground and verified ingestion `20261114020000`.
4. Business knowledge/catalog `20261114030000`.
5. **Unapplied Phase 7A** `20261114040000`; review its own pre/postflight first.
6. **Unapplied Phase 7B** `20261114050000`.

Use [read-only preflight](sql/phase7b-preflight.sql) before 7B and
[read-only postflight](sql/phase7b-postflight.sql) after application. Review schema
history instead of blindly replaying earlier migrations. Check function exposure
in PostgREST as well as ACLs/RLS. Missing capabilities show a safe unavailable
page; they never fall back to unguarded generation. Review initialization locking
and expected table counts before application to populated storage.

CLI migration creation was attempted but the available CLI could not initialize
in its read-only home; the uniquely numbered review-only SQL file was then
created directly. No CLI database/migration-application command was used.

## Validation and remaining manual checks

Automated coverage executes the real engine, server actions, owner guards,
retrieval, simulator and settings screen with synthetic mocked storage. Existing
webhook signature/dedup, tenant isolation, Phase 6B and Phase 7A regressions remain
in the complete suite. New cases cover modes, authorization, stale settings,
human control, new-inbound/workflow/configuration races, unavailable knowledge,
expired reservations/three-attempt bound, Arabic/English uncertainty scenarios,
bounded/redacted history, hard-disabled transport and future lifecycle contracts.

**Mocked storage and modeled RPC transactions do not prove live PostgreSQL
locking, trigger behavior, catalog compatibility, RLS or grants.** SQL and
PL/pgSQL grammar parsing is offline only. No live SQL, signed-in production
browser flow, real OpenAI/Meta call, deployment or credential setup was performed.

Required before future activation:

- Apply the reviewed migrations only with separate authorization, then run both
  phases' read-only postflights. Inspect initialized modes, indexes, ACLs and RLS.
- In disposable PostgreSQL with synthetic A/B tenants, exercise owner/member/
  anonymous/service sessions and direct RPCs, including forged sources, foreign
  conversations, duplicate ingestion, concurrent reservations, takeover cycles,
  changes/revocations during generation, TTL retries, knowledge changes, and
  exact completion retries. Confirm no authenticated table DML or service RPC
  execution is available for automation.
- In a signed-in test browser, verify workspace switching, unavailable-schema
  screens, stale form conflicts, Arabic direction, working-hours boundaries,
  explicit human release, audit history and local draft review/approval. Observe
  that no provider request or delivery record occurs on any action.
- Evaluate real model quality only under separate authorization. General
  policy/FAQ/rule interpretation remains outside deterministic simulation.
- Keep the transport hard-disabled through Phase 8/9 until final activation
  requirements in the [roadmap](wasla-roadmap.md) have independent approval.

Validation: **183 tests passed** (163 existing regressions plus 20 automation
cases). `npm run lint` passed with zero errors and the existing unused
`_cacheHeaders` warning in `src/utils/supabase/server.ts`. `npx next typegen`,
`npx tsc --noEmit` and `npm run build` passed. Offline `pglast` parsing passed
for the new migration, all five PL/pgSQL functions and both read-only SQL files.
This is mocked/static validation, not live PostgreSQL verification.
