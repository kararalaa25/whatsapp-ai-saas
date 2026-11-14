# Phase 6B: knowledge-aware customer-service previews

## Using Studio

Open the selected workspace's **AI Agents** page. Type a synthetic customer
question, then choose **Inspect knowledge** to see selected products, FAQs and
business policies without generating a reply, enabling the agent, reserving
model quota, saving messages, or calling a provider. For received WhatsApp test
conversations, inspection uses the latest stored unanswered customer text.

The source panel shows exact price/currency, availability, SKU/category, full
reference text and match reasons. It distinguishes no match from unavailable
storage and flags spelling, cross-script and variant uncertainty. Expand
**Read full selected reference** for policy qualifications. The panel describes
the latest inspection/generation, not a persisted audit trail. Editing the next
question, selecting/creating a conversation, or resetting the temporary demo
clears it. Refresh restores the saved conversation, not old debug selections.
The workspace header links directly to knowledge management.

Enable previews to generate a reply. **Demo** is always a deterministic,
explicitly simulated example, not model-generated text. Its templates demonstrate
clarification, recorded price, unknown/missing facts, unavailable/preorder stock,
delivery-location questions, and human-request acknowledgment. A confirmed
single product can supply its exact structured price/currency or stock status;
zero is distinct from unknown. Possible spelling/transliteration/variant matches
require identity confirmation. Templates do not interpret or repeat arbitrary
FAQ/policy instructions or claim a transfer, reservation, shipment or notification.
They are not an evaluation of model fluency or general question answering.

Optional OpenAI previews continue to use saved settings and existing quotas;
Phase 6B does not request/configure credentials. Real model output is still a
human-reviewed draft. Actual WhatsApp sending remains unconditionally disabled.

## Retrieval and continuity

- Matching normalizes Unicode, Arabic diacritics/alef/ya/ta marbuta and common
  Iraqi/Persian letter variants **only for searching**. Stored/displayed facts
  are never normalized or rewritten.
- An extensible synonym vocabulary covers Iraqi Arabic and English price,
  availability, delivery, payment, returns, opening-hours and human-contact
  questions. Examples include `اشگد سعر سوفاج؟`, `توصلون للبصرة؟`,
  `شلون أدفع؟`, and `اريد احچي ويا موظف`.
- Product names and exact SKU phrases rank above category/description mentions.
  Limited single-edit/adjacent-swap matching applies only to name words with at
  least five letters, never numeric sizes or prices. A low-weight cross-script
  consonant hint can match examples such as سوفاج / Sauvage or لينوفو / Lenovo;
  signatures shorter than three consonants are deliberately ignored. These are
  possible identity hints, **not translation or semantic understanding**.
- Known SKU-prefix mismatches and different/unconfirmed named sizes are flagged
  as possible variants rather than silently substituting a different price.
  This is conservative heuristic matching, not a complete variant/SKU resolver.
- Explicitly requested business policies get context space before generic product
  matches. FAQs use bilingual keyword matching. Inactive products/FAQs remain
  excluded. An unrelated/unknown product is not assigned the previous product's
  facts merely because the question asks a price.
- Short follow-ups such as `وشكد سعره؟` or `How much is it?` can reuse the latest
  recognizable subject among the last three **customer** turns in the bounded
  context. Assistant drafts never establish product identity or current facts.
  A newly named product overrides old context; unrecognized new subject words
  prevent silent fallback. Multiple possible subjects remain ambiguous and
  require clarification. Spelling/variant uncertainty is retained across turns.
- The existing catalog bounds remain 500 products, 200 FAQs, and five policy
  entries per workspace. Selected JSON is limited to eight whole entries and
  10,000 characters. Whole records that do not fit are omitted; descriptions,
  answers and policy qualifications are never cut mid-sentence.

## Prompts and privacy

Provider requests use a contiguous recent tail of **at most 12 messages and
12,000 characters**, without generated summaries or cross-conversation memory.
Leading assistant-only fragments are removed. Existing history validation still
accepts at most 20 input messages before bounding. The current question, system
settings, retrieved context and output have their existing separate bounds;
character limits are not an exact token budget.

Saved conversation history always comes from the owner-authorized,
workspace-and-conversation-scoped server reader. Client-supplied local history
is ignored for saved conversations, including inspection. The original transcript
is still stored/displayed under the existing owner-only access policy; the
provider context is a separate minimized representation.

Before provider context is assembled, common customer email, phone/long-number,
bearer/JWT/API-key and credential-assignment patterns are redacted from the
current customer message and recent dialogue. This is **best-effort minimization,
not a complete PII/secret detector**: it can miss unfamiliar formats and may
redact nonprivate long numbers/dates. Business knowledge and owner-supplied agent
settings are not scrubbed because they are intentional business context; do not
put credentials or customer secrets there. No new logs, analytics, localStorage,
shared transcript cache, summaries or external image fetches were added. Debug
results contain selected business references and context counts, not raw customer
questions or history. They stay in owner-only request/component state.

System rules ask the model to respond naturally in the customer's language,
including friendly Iraqi Arabic when appropriate, preserve exact prices/currency
and policy exceptions, distinguish unknown/out-of-stock/preorder, confirm uncertain
product variants, ask useful clarifying questions, and acknowledge human requests
without claiming an actual handoff. History is untrusted and prior drafts are not
current business facts. Retrieved references are JSON-serialized in a separate
**user-role data message**, never inserted as system instructions. Commands inside
those references do not authorize actions. This layering reduces injection risk;
it does not guarantee arbitrary model behavior. There are no model tools, and
provider calls retain `store:false`, a 600-token output cap, timeout and no retries.

## Authorization and migration review

**No migration is required.** Existing applied migrations are unchanged. The
existing workspace-scoped tables, owner checks, RLS and write RPCs are reused.
The new `inspectKnowledge` server action rechecks owner access, validates input,
uses saved history only from its selected conversation, and calls the same
owner-authorized knowledge reader as generation. A foreign conversation/workspace
combination fails before knowledge is exposed. Debug does not create a new table
or relax grants. Knowledge storage failure blocks OpenAI generation before quota
reservation; simulated mode remains available.

The Phase 6A product/FAQ/information foreign-ID, archive/write, member-denial,
owner-downgrade, payload-injection and SQL-source regression matrix is retained.
Only the missing new inspection-boundary tests were added to that matrix. The
WhatsApp outbound module, webhook ingestion and existing migration files are
unchanged. No SQL/migrations, production mutations, configuration or deployments
were performed during this task.

## Evidence and remaining checks

Automated tests exercise real matching, bounded/redacted context, prompt assembly,
server action functions, React component handlers and server-rendered panel HTML.
They use synthetic fixtures with mocked Supabase transport/membership/storage,
mock providers, and mocked React hooks for lifecycle actions. The new inspection
boundary also runs the **real** workspace selection and owner-authorization
functions against mocked clients. Existing migration assertions remain **static
source checks**, not database execution.

Coverage includes Iraqi Arabic questions, spelling/transliteration, exact facts
and unknown/zero values, ranking/size limits, whole policy qualifications,
ambiguous/new/old product subjects, forged client history, latest WhatsApp text,
redaction, prompt injection, no-provider demos, standalone inspection, stale-panel
clearing, and tenant/non-owner access. No live PostgreSQL, signed-in browser or
real OpenAI response verification was performed for Phase 6B. The earlier drowsy /
jjj browser catalog isolation result is user-reported Phase 6A evidence, not new
verification of this implementation.

Later manual checks, with synthetic test conversations only:

1. In an owner session, inspect Iraqi/English product and delivery questions;
   compare exact selected facts and full policy exceptions to the catalog.
2. Start a saved playground, ask about a named product, then ask `وشكد سعره؟`.
   Confirm the subject, ambiguity prompts, refresh persistence, and fresh debug
   selection after inspection. Change the subject and verify old facts clear.
3. Switch workspaces/conversations and confirm no previous selections/transcript
   appear. Try foreign workspace/conversation IDs and member access; denial must
   match the existing isolation model. Existing read-only Phase 6A postflight
   catalog checks remain available for administrators if live ACL review is needed.
4. Real model naturalness, grounding and adversarial robustness require a separate
   future evaluation in an already authorized provider-enabled test environment.
   No key is needed for any implementation/test/inspection step in this task.
5. Confirm WhatsApp remains locked: no delivery, notification or transfer occurs.

Validation result: **130 tests passed** (81 existing tests plus 49 new Phase 6B
cases). `npm run lint` passed with no errors and the pre-existing unused
`_cacheHeaders` warning in `src/utils/supabase/server.ts`. Next route type
generation, standalone `npx tsc --noEmit`, and `npm run build` passed. No external
provider, live database, signed-in browser session, deployment or migration was
used by these checks.
