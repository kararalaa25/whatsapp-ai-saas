# Phase 6A: business knowledge and product catalog

## Scope and use

Each workspace dashboard now links to **Knowledge Base** at
`/dashboard/knowledge?workspace=<uuid>`. Only the verified workspace owner can
read or manage this page and its server actions, consistent with Agent Studio.
Products, FAQs and Business Information have separate sections, empty states,
validation, pending/error/success feedback, and Arabic-friendly `dir="auto"`
text fields. Workspace-keyed components prevent one workspace's local editor
state from carrying into another workspace.

Products support create/edit, inactive status (archive), confirmed permanent
delete, search across name/description/category/SKU, and category filtering.
Fields include name, description, category, price, currency (IQD initially), stock
status, SKU, active status, and an optional HTTPS image URL. A blank price is
unknown, distinct from zero; stock defaults to unknown. Supported currencies are
IQD, USD, EUR, GBP, SAR, AED, KWD, JOD and TRY. Prices allow two decimal places.
Nonblank SKUs are unique within a workspace, ignoring case. Image URLs are
metadata only: there is no upload, image rendering, fetch, or URL unfurling.

FAQs support create/edit/inactive/delete. Business information supports one
confirmed entry for each of opening hours, delivery, payment methods, returns,
and general information, with create/edit/delete. No product or policy defaults
are invented. No seed rows are included; synthetic perfume fixtures live only
in automated tests. Existing generated drafts are not retroactively changed
when knowledge changes or is deleted.

## Retrieval and agent integration

`src/utils/knowledge/access.ts` reads with the authenticated, request-scoped
client after verifying current owner access. Every table query explicitly filters
the verified workspace ID. There is no privileged client or cross-tenant cache.

`src/utils/knowledge/retrieval.ts` performs deterministic keyword ranking over a
bounded catalog, not semantic/AI search. It supports Unicode tokens and Arabic
alef/diacritic normalization, weights product names/category/SKU and FAQ questions
above descriptions/answers, and includes Arabic/English keywords for policy
topics. Inactive products and FAQs never enter retrieval. No match returns an
empty context. Lexical matching can miss synonyms, inflections, misspellings or
implicit intent; this MVP makes no semantic-search claims.

The limits are **500 products, 200 FAQs, five business-information entries per
workspace**, enforced inside the write RPC with a workspace lock so concurrent
supported inserts cannot exceed the cap. Reads use those same bounds. This
keeps in-memory ranking simple and complete within the supported catalog size.
The final retrieved JSON is at most **eight complete entries and 10,000
characters**; an entry that does not fit is omitted rather than cutting facts or
policy qualifications mid-sentence. These are character bounds, not an exact
token count. Existing history/input/output bounds remain in place.

`previewReply` retrieves server-side knowledge for the actual question (including
the latest received WhatsApp test text), before any model quota reservation.
`buildPrompt` places JSON-serialized knowledge in a separate **user-role** data
message, outside system instructions, before the customer's question. System
rules explicitly reject commands embedded in knowledge, forbid inferred
prices/stock/policies, treat null/unknown values as unknown, and require
clarification/human help for missing or conflicting facts. This is prompt
injection defense, not a guarantee about arbitrary model output; previews still
require human review and cannot call tools or deliver messages.

Demo mode remains clearly simulated in English/Arabic and never pretends to
use a model. Phase 6B adds deterministic service templates that can quote
validated structured product facts when identity is confirmed; uncertain
identity requires clarification. See the [Phase 6B guide](phase6b-knowledge-assistant.md). It works even
if Phase 6A storage is unavailable. Real OpenAI previews consume this knowledge
when an API key is configured later; retrieval failure blocks the model call and
quota reservation with a safe error. An empty but available knowledge base is
valid and the no-invention rules still apply. No API credentials or environment
configuration were added. Actual WhatsApp sending remains unconditionally blocked.

## Migration and security review

New, **unapplied** migration:
`supabase/migrations/20261114030000_business_knowledge_catalog.sql`.
It is ordered after all existing migrations; none of those files were edited.
No SQL, schema changes, migrations, data seeding, deployments, or external API
configuration were executed during this work. CLI scaffolding was unavailable
in this environment (latest CLI attempted a read-only home directory; the older
CLI installation failed), so the new migration was authored as a reviewed file.

- Three new tables: `business_products`, `business_faqs`, `business_information`.
  All are postgres-owned, RLS-enabled, and expose owner-only authenticated SELECT
  through the existing private `is_workspace_owner` helper. No anon/table write
  or service-role table grants are added. All existing policies remain intact.
- Each row references its workspace with `ON DELETE RESTRICT` and has a unique
  `(workspace_id, id)` identity for future tenant-scoped relationships. These
  three entities do not reference each other; no child relationship currently
  needs a composite tenant foreign key. Future product attachments/variants must
  reference `(workspace_id, id)` rather than the product ID alone.
- Only `save_business_knowledge(uuid,text,uuid,jsonb)` and
  `delete_business_knowledge(uuid,text,uuid)` grant authenticated EXECUTE. Both
  explicitly reject missing auth, verify actual owner membership, lock/recheck
  the workspace, and scope updates/deletes by **both** workspace and item ID.
  Foreign item IDs fail rather than creating or mutating rows elsewhere.
- These are deliberately narrow SECURITY DEFINER writes to support RPC-only
  mutations without client DML grants, matching existing phases. They use an
  empty search_path, fully qualified application objects, postgres ownership,
  fixed branches (no dynamic SQL), and revoke PUBLIC/anon/service-role EXECUTE.
- JSON payloads are full replacements with exact allowlisted keys and types;
  identity/workspace fields cannot be mass-assigned. SQL constraints duplicate
  essential lengths, nonblank values, currency/stock/topic allowlists, numeric
  precision/range and metadata URL restrictions. No schema or table name comes
  from user input. Raw database errors and internal details are not shown.
- Hard delete needs an explicit UI confirmation. Inactive status is the
  reversible archive option. Concurrent owner edits currently use last-write
  wins, as a deliberately simple MVP; revision control can be added later.

## Later manual application (not performed here)

1. A migration administrator reviews the new migration and runs the SELECT-only
   [`preflight`](sql/phase6a-preflight.sql). Confirm all Phase 4/5A/5B prerequisites,
   the owner helper's definition/privileges, and that the five Phase 6A objects
   do not already exist. Do not reapply existing migrations.
2. Apply only the reviewed new Phase 6A migration through your normal manual
   process. It is transactional and has no seed data or external side effects.
3. Run the SELECT-only [`postflight`](sql/phase6a-postflight.sql). Expect three
   owner-read policies, no client writes, two narrowly executable RPCs, empty
   search_path, expected constraints/indexes, and zero PUBLIC ACL grants. These
   are catalog checks and do not alone establish tenant isolation at runtime.
4. In test workspaces with two different authenticated owners and an ordinary
   member, manually verify product/FAQ/policy create/edit/archive/delete and
   refresh persistence. Try a foreign workspace URL, foreign item ID in each
   mutation, and ordinary-member reads/writes; they must be denied. Verify
   workspace switching clears editors. Do not use production/customer data.
5. In Agent Studio, test saved demo replies and refresh. Demo must remain
   simulated and WhatsApp sending locked. Provider-context integration is tested
   with a mock; no external credentials or model calls are needed now.

Before manual migration application, the Knowledge Base page reports unavailable
storage; existing dashboard, WhatsApp receiving and simulated Agent Studio flows
remain usable. Live PostgreSQL/RLS behavior and signed-in browser verification
are intentionally pending manual application, not claimed as completed here.

## Automated validation

`npm test` runs the entire suite, including the existing Phase 5B persistence
regressions. New tests exercise real validators, action functions, retrieval,
agent integration and component event handlers against authenticated-client and
provider mocks. They cover product CRUD/archive, FAQs and all policy topics,
foreign workspace/ID rejection, malformed inputs, storage/RPC failures,
Arabic/English relevance, exact unknown/price values, context limits without
truncation, prompt-role separation/injected commands, confirmed deletion,
escaped HTML, editor preservation on failure, and workspace-keyed page rendering.
Migration assertions are static source checks, not execution of PostgreSQL.

Required checks: `npm test`, `npm run lint`, `npx next typegen`,
`npx tsc --noEmit`, and `npm run build`.

Validation result for this change: all **57 tests passed**, including the
existing Phase 5B regressions; route type generation, standalone TypeScript and
the production build passed. Lint passed with no errors and the one pre-existing
unused `_cacheHeaders` warning in `src/utils/supabase/server.ts`. Existing
migration files and the WhatsApp outbound module are unchanged.
