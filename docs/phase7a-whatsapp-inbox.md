# Phase 7A: WhatsApp test inbox and local AI drafts

## Availability and migration

The workspace dashboard's **Conversations → Open WhatsApp conversation inbox**
links to `/dashboard/inbox?workspace=<uuid>`. The selected conversation is kept in
the URL for refresh restoration. Owner authorization is checked on every read
and write; components are keyed by workspace and selected conversation so local
editors do not carry across tenants. The mobile view switches between the list
and detail; desktop shows both columns. Arabic/English message text uses
`dir="auto"`; timestamps show Baghdad time, labeled in the interface.

**New, unapplied migration:**
`supabase/migrations/20261114040000_whatsapp_conversation_inbox.sql`.
No existing applied migration was edited. No SQL/migration, production data
mutation, external configuration, deployment or actual WhatsApp send was
executed. Until manual application, the new inbox shows a safe unavailable state.
Existing Studio functionality remains available; its WhatsApp generation path
keeps pre-migration behavior only when both new table and reservation RPC report
recognized missing-capability errors. If the table/cache is missing but the RPC
is installed, that RPC must still authorize generation. Permission/other errors
never grant permission. The manual postflight must confirm both capabilities are
properly exposed after application; missing API capabilities are not proof that
the underlying database is unmigrated.

The migration creates owner-only state/draft tables, private counters, RPCs,
triggers and paging indexes. At manual application it initializes **metadata
only** for existing WhatsApp conversations. Existing closed threads start with
human control; verified historical messages start unread until explicitly marked.
It does not synthesize/backfill messages or alter their contents. New messages
continue through the existing signature-checked webhook and unchanged Phase 5B
ingestion RPC; triggers initialize/update workflow state in that transaction.

## Inbox and verified history

Grouping reuses `ai_conversations` and its unique `(connection_id, customer_wa_id)`
identity plus workspace/connection composite foreign key. A customer with the same
identifier on another test connection or workspace has a different thread.
Phase 5A's globally unique Meta message ID and Phase 5B's unique inbound reference
continue to deduplicate retries before any new workflow state/unread effect.
Unsupported messages and senderless historical records are not guessed into
customer conversations.

The list shows customer identifiers, test connection ID, status, assignment,
verified-text preview, received timestamp and unread count. It uses exclusive
keyset pagination on `(updated_at, id)` with 30 visible rows plus a lookahead;
there is a status filter and explicit refresh. Live updates can move a thread
before a paging cursor; refresh the list to see newly bumped threads. Pages are
not a frozen database snapshot. Duplicate rows are merged by conversation ID.

Message pages use exclusive `position < before` cursors, 30 rows plus lookahead,
then return chronological stored-position order. Explicit earlier-page loads
merge by message ID and position. Ordering follows persisted conversation
sequence, not an untrusted payload timestamp. The owner controls how many pages
they inspect; generation independently rereads only the latest bounded page.

Only `role=user`, `provider=customer`, non-null-source rows are eligible. Each is
joined to the authoritative inbound record and validated for identical workspace,
connection, source ID, body and text type. Local/manual/Studio drafts are never
customer messages. A new trigger rejects inconsistent WhatsApp customer inserts;
only the existing server-only, signature-verified service ingress can create
legitimate inbound records. SQL cannot independently recheck Meta's HMAC: it
trusts that existing service-only ingress boundary. An administrator compromise
or stolen privileged ingress credential remains outside client RLS protection.

**Mark visible messages read** advances a monotonic workspace-owner read marker
only to a verified position the UI actually loaded. Opening a thread alone does
not mark it read. If a newer text arrives before that request, the newer position
stays unread. Read state is shared owner/workspace state, not per-assignee state.

## Management and human control

An owner can assign a conversation to an existing member of the same workspace,
set **Open / Pending human / Closed**, and enable human takeover. The UI lists
up to 100 members; an existing assignment outside that list is preserved.
Assignment is workflow metadata, **not an access grant**: ordinary members/admins
still cannot open or manage this owner-only inbox. The composite membership FK
requires unassignment before removing an assigned member.

Management uses expected state revisions to reject overwrites. Pending human and
closed force takeover. Reopening does not silently release takeover: choose Open,
explicitly uncheck takeover, then Save management. The view disables generation
immediately when takeover is selected; other sessions observe saved controls.
Manual drafting/review remains available under human control, except closed
threads must reopen before creating/editing/approving. Discard remains available.

A verified new text to a closed conversation reopens its legacy conversation
status and moves inbox state to **Pending human**, keeping takeover enabled.
Legacy Studio close/reopen synchronizes workflow state too; legacy reopen cannot
silently release a human takeover. Human-request wording such as
`اريد احچي ويا موظف` routes an owner generation attempt to pending-human state
without creating a reply, reserving model quota or claiming a transfer/notification.
Detection is conservative keyword routing, not complete language understanding.

Generation checks takeover/status in the application and again under a database
lock. In-flight generations are rejected at save if control/revision changes.
The old Studio checks the same state and shares the inbox rate reservation; a
DB trigger also rejects legacy assistant inserts while human control is active.
A model request already in flight may finish/consume budget, but its stale result
is not persisted as a new draft. There is no automated webhook generation. Inbox suggestions require saved enabled
agent settings; the older Studio demo retains its editor-enabled setting behavior.

## Local draft workflow — never a delivery workflow

- **Suggested draft:** uses the latest verified customer text and recent verified
  customer-only history. It excludes previous unsent assistant drafts from the
  conversation context and uses Phase 6B retrieval, natural-language grounding,
  uncertainty handling and privacy minimization. The provider context is at most
  12 messages / 12,000 characters plus eight full knowledge entries / 10,000
  characters. Demo uses clearly labeled deterministic templates, not a model.
- **Manual draft:** owner-written text is stored separately from customer history.
  It is tied to the observed latest source position; new messages arriving while
  an owner types cause rejection rather than silently rebinding their reply.
- **Edit:** saves a new revision, marks edited, resets approval, and requires review
  again. Original source position and knowledge snapshot remain attached.
- **Approve locally:** records a local approval/actor/time only. The source must
  still be the latest verified text; knowledge references must still match the
  active workspace facts. No API request, queue, outbox, notification, transfer,
  reservation or delivery is created by approval.
- **Discard:** retains a terminal discarded local record; it never deletes inbound
  history or marks an outgoing message delivered. Older drafts remain labeled
  NOT SENT even if locally approved. Newer customer messages make old draft
  sources stale and prevent approval.

There is at most one active (draft or approved) candidate per inbound source,
which also protects uncertain request retries from duplicate active drafts.
Discard before generating/replacing a candidate. Detail reads return the latest
20 drafts; up to 100 local drafts per conversation are supported, including
previously discarded drafts. That cap bounds local workflow growth without
silently deleting history; exceeding it requires future reviewed retention work.
Older Phase 5B/6B Studio drafts remain visible in Studio and are not promoted
into new inbox drafts or into customer history.

Retrieved references are stored as exact business-fact snapshots. The create RPC
validates every reference against an active record in the same workspace and
rejects changed/foreign facts; approval revalidates the snapshot. Full policy
qualifications remain available for review. Reference JSON has eight-entry and
50KB storage bounds (UTF-8/JSONB representation differs from the 10,000-character
provider bound). Raw customer questions/history are not duplicated in reference
metadata. Owner-curated business text remains untrusted for model instructions.

The unconditional `sendTestReply` hard stop is unchanged. There is no new send
function, transport, access-token parameter or delivered status in this feature.
Meta status-only events are still acknowledged by the existing webhook without
being interpreted as outgoing delivery confirmations. Future real sending needs
an independently reviewed implementation, revalidation of all facts/control and
fresh verified Meta receipts; a local approval must never be treated as delivery.

## Authorization, bounds and security review

- Public workflow tables are postgres-owned, RLS-enabled, authenticated owner-only
  SELECT; PUBLIC/anon/service-role grants and all authenticated table DML are
  revoked. The quota table is private, RLS-enabled and has no client privileges.
  The older Phase 5A raw inbound monitor remains member-readable within its own
  workspace under its existing policies; this change does not expand those
  privileges or grant members access to inbox state or local drafts.
- Conversation/source and membership relationships use composite tenant FKs.
  All server actions recheck the actual authenticated owner and derive customer /
  connection identity from a tenant-filtered WhatsApp conversation, not client
  customer identifiers. A foreign conversation, draft or assignee is rejected.
- Mutation RPCs are narrow SECURITY DEFINER entry points with postgres ownership,
  empty search_path and PUBLIC/anon/service-role EXECUTE revoked. Private helpers
  and trigger functions have no client execution rights. The list RPC is SECURITY
  INVOKER, checks owner access, and also runs through existing table RLS.
- Mutation helpers lock workspace then conversation, recheck owner access and
  validate current revisions/source positions before writing. Reference validation
  uses workspace-filtered rows and rejects fabricated facts, not just foreign IDs.
  Inputs validate UUIDs, enum operations, revisions and nonblank 6,000-character
  draft text; raw database errors and credentials are never sent to the browser.
- Generation is limited to **6 per fixed minute window and 100 per UTC day per
  authenticated owner across all workspaces**, enforced by atomic private quota
  upserts. Old Studio WhatsApp generation shares these limits after migration.
  OpenAI additionally retains its existing 50-attempt daily limit. Failed provider /
  stale-save attempts count once reserved; read/manual/approval actions do not
  consume model budget. Rate buckets older than two days are cleaned only for
  the calling owner by the reservation RPC. This is not a distributed read/WAF
  limiter; production abuse controls remain future work.
- No Meta credential is loaded by inbox code. Provider requests contain customer
  text only through Phase 6B bounded/redacted prompt handling, not phone/customer
  IDs or assignment UUIDs. Redaction remains best effort; established transcripts
  and manual drafts are owner-readable personal data and need a production
  retention/deletion policy before live use. No browser localStorage, message
  telemetry, external image fetching, service-role inbox reads or background
  delivery worker was added.

## Verification evidence and manual application

Automated tests use real server actions, owner/workspace guards, the existing
JavaScript ingestion adapter, retrieval, simulated generation, UI event handlers
and server-rendered HTML with mocked auth/Supabase storage/RPC/provider transports.
Grouping, deduplication, quota, triggers and transactional rejection are modeled
contracts, **not execution of PostgreSQL**. Migration source assertions and local
`pglast` grammar parsing check SQL/procedural syntax; parser success does not prove
catalog compatibility, actual RLS/ACL behavior, PostgREST join shape, concurrency
or runtime semantics. No SQL was executed on a connected or disposable database.
No signed-in browser or real model/Meta call was made for Phase 7A.

Later, in the authorized test environment:

1. Review the new migration and run the SELECT-only
   [preflight](sql/phase7a-preflight.sql). Verify existing schemas/owner helper,
   tenant composite keys, ingress grants, and absence of Phase 7A objects/triggers.
   Review the index/trigger locking window before applying to any populated DB.
2. Apply **only** the new reviewed migration manually; do not edit/reapply older
   migrations. Run the SELECT-only [postflight](sql/phase7a-postflight.sql) to inspect
   privileges, policies, trigger definitions, constraints and metadata/source gaps.
   Investigate a nonzero gap count without blind repair or deletion.
3. In an isolated disposable database with synthetic A/B workspaces, exercise
   authenticated owner/member/anonymous sessions and direct RPC calls. Prove RLS,
   foreign conversation/source/reference/assignee/draft rejection, revision races,
   simultaneous ingestion dedup/position allocation, quota atomicity across
   workspaces, and takeover/new-inbound/approval races. Never use production
   customer records for mutation tests. Parser/mocks do not substitute for this.
4. In a signed-in owner browser, inspect mobile/desktop list/detail navigation,
   unread markers, paging, Arabic text, assignment, close/reopen/takeover, new
   messages to closed threads, saved manual/simulated drafts, edit/approve/discard,
   knowledge references, refresh restoration and cross-workspace UI reset.
5. Confirm the old Studio cannot generate/save around takeover or quota. Confirm
   approval and all fallback paths produce no Meta network request. Real model
   output quality can be evaluated separately only in an already authorized
   provider-enabled test environment; no credentials are needed for this MVP.

No deployment is part of this task. The new inbox's live browser/database behavior
remains pending manual application and verification of the unapplied migration.

Validation result: **163 tests passed** (all 130 prior tests plus 33 inbox cases).
`npm run lint` passed with no errors and the existing unused `_cacheHeaders`
warning in `src/utils/supabase/server.ts`. `npx next typegen`, standalone
`npx tsc --noEmit`, and `npm run build` passed. Local SQL/procedural grammar
parsing passed for the migration and both read-only check scripts; no database
connection or SQL execution was involved.
