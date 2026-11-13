# Wasla AI — owner-only agent preview

Open a workspace → **AI Agents → Configure agent and test replies**. Only its
owner may enter. Enable previews, enter synthetic business guidance, and use
**Demo** for a deterministic, explicitly simulated response without any API key.
Temporary demo works before the new migration and is not saved. No environment
variables are required to build or run the automated tests.

Later, separately review/apply **only**
`supabase/migrations/20261114020000_ai_agent_playground.sql` after the already
applied workspace and Phase 5A migrations. Do not rerun or edit those migrations.
Saved settings/history and new WhatsApp conversation ingestion need this schema.
The new migration adds one composite unique constraint to the existing inbound
table; it does not backfill or change existing messages. PostgreSQL execution,
RLS and concurrent-delivery tests have not been performed by this implementation.

Save settings, start a **New playground**, and type customer questions. For real
model drafts, optionally configure server-only `OPENAI_API_KEY`, restart, select
**OpenAI preview**, and use saved settings. Model choices are allowlisted in code
and SQL. This makes paid model calls and sends the selected business guidance
and latest 20 messages to OpenAI with `store:false`; review provider retention
and use synthetic data only. A database reservation limits each owner to 50
OpenAI preview attempts per UTC day across all their workspaces, including failed
provider attempts. Each call has a 20-second timeout, no automatic retries and a
600-token output cap. Demo does not simulate model quality or policy
compliance. No prompt can guarantee resistance to prompt injection; there are no
model tools or action execution paths, and outbound delivery is blocked in code.

Phase 5B's webhook calls the new service-role-only `ingest_whatsapp_ai_test_message`
RPC, which delegates unchanged Phase 5A persistence and atomically groups NEW
text messages by verified connection plus signed sender ID. Apply the new
migration before testing this updated webhook; until then storage returns 503
and Meta can retry. Existing Phase 5A messages without a sender are not guessed
into conversations. Keep all Meta assets and message contents test-only. The
stored sender ID is personal data even in a test environment; new tables are
owner-readable only, with no direct client writes. Establish retention before
any production use. No external services were contacted in automated tests.

In the studio, select a received WhatsApp test conversation and generate a draft
for its latest unanswered text. Drafts stay in the studio; nothing is delivered.
Refresh to load new webhook conversations. Close/reopen threads to manage the
test inbox. Generation saves use a revision check to reject stale parallel
results. Before production add distributed rate limits, model budgets, durable
jobs, human escalation, retention and explicit ownership-transfer tests.

`sendTestReply` is an unconditional hard stop: neither environment variables nor
the preview toggle can enable sending. The separate preparation utility validates
test phone/recipient allowlists but accepts no credentials and performs no HTTP
request. Enabling delivery requires a later reviewed change and explicit testing.

Checks: `node --test tests/*.test.mjs`, `npm run lint`, `npx tsc --noEmit`,
`npm run build`. Live check later: owner opens studio; member/foreign workspace
is refused; save settings; run two playground turns; refresh and reopen history;
receive a synthetic signed test message; generate a draft; confirm no send call.
