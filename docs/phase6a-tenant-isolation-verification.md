# Phase 6A tenant isolation verification

Reviewed main at `17f2f2b970baaeb52508745bc6b7efd9495ca889`.
No confirmed application defect was found. This change adds regression tests and
this evidence report only; application code, migrations and outbound sending
behavior remain unchanged. No connected Supabase tools, database queries, SQL,
production data changes, external credentials or deployment were used.

## What the new tests verify

`tests/knowledge-isolation.test.mjs` executes the **real** functions
`loadDashboardState`, `requireAgentOwner`, `readKnowledge`, `loadKnowledgePanel`,
`saveKnowledge`, `deleteKnowledge` and `retrieveKnowledge`. Auth claims, the
Supabase transport, membership records and persistent storage are mocked. Both
workspaces contain an existing product, FAQ and business-information record.
Fixtures are synthetic and exist only in process memory.

| Protection | Evidence |
| --- | --- |
| Owner A selecting workspace B is denied | Real application authorization rejects panel/read/retrieval and update/archive/delete; zero knowledge-table requests or RPC calls occur. |
| Reading workspace B cannot expose A records | Real panel/reader/retrieval apply explicit workspace filters, even when the user owns both A and B. The mock deliberately does **not** emulate knowledge-table RLS, so this checks application query scoping itself. There is no separate read-by-product-ID API in this implementation. |
| Owner B supplies B plus an existing A item ID | Real actions pass the exact verified workspace and supplied item ID, handle the mocked RPC rejection, do not invalidate cache as a successful write, and preserve all fixture rows. This checks the application/RPC contract, **not SQL execution**. |
| Dual owner mixes A/B item and workspace IDs | Both directions fail in the modeled RPC contract for products, FAQs and business information. Existing A and B fixtures remain unchanged. |
| Archive cannot bypass isolation | Products and FAQs use the same save action/RPC with `active: false`; foreign-tuple attempts fail and preserve existing active state. Business information has no archive operation; its edits and deletes are tested. |
| Ordinary members cannot manage owner-only knowledge | Real workspace and owner guards reject reads, creates, updates, archive attempts and deletes in both workspaces before knowledge queries/RPC calls. Owner-role and authenticated-user filters are asserted. Admins and unauthenticated sessions are also denied. |
| User-editable role metadata cannot confer owner access | Mock member/admin claims deliberately include `user_metadata.role = owner`; the actual guard still checks current membership, and denies them. |
| Revoked owner access is rechecked | After an authorized panel load, changing the mock membership to member blocks subsequent reads and writes. Earlier authorization is not reused. |
| Payload cannot mass-assign tenant/identity/item ID | Product, FAQ and information actions reject injected `workspace_id`, `owner_id`, `user_id` and `id` before calling an RPC. |
| Valid management remains supported | The correct owner/workspace/item tuple edits/deletes normally; products/FAQs can be archived, and the other workspace's rows remain unchanged. Existing functional and Phase 5B tests run too. |

The mocked RPC intentionally models owner authorization and the combined
workspace/item predicate from the migration. It is not an interpreter of the
migration and cannot detect an incorrectly installed function by itself.

## Inspected SQL protections (static evidence only)

New source assertions inspect each table and each mutation branch independently:

- Each of the three Phase 6A tables enables RLS, revokes PUBLIC/anon/authenticated/
  service-role grants, then grants authenticated SELECT only. Its sole migration
  policy is SELECT using `workspace_private.is_workspace_owner(workspace_id)`.
- The Phase 5B private owner helper matches workspace ID, `auth.uid()` and actual
  membership role `owner`. It does not authorize from user-editable metadata.
- Both Phase 6A write RPCs require authenticated owner access before mutations,
  are postgres-owned SECURITY DEFINER functions with an empty search_path, and
  revoke PUBLIC/anon/service-role EXECUTE before granting authenticated EXECUTE.
- Every product/FAQ/information UPDATE and DELETE branch uses both
  `workspace_id = p_workspace_id` and `id = p_id`. Archive is an ordinary UPDATE.
  The application cannot authorize a foreign row merely by selecting another
  workspace it owns. The SQL raises on unavailable rows rather than silently
  acknowledging an update/delete that matched nothing.

These are checks of committed migration **source**, not checks of database
catalogs, effective deployed grants, PostgREST behavior or PostgreSQL RLS execution.

## Live PostgreSQL coverage and remaining manual verification

**No live PostgreSQL tests were run**, either on the connected project or an
isolated database. No connected catalog queries were run. Therefore this change
does not establish whether Phase 6A is currently applied, or whether the live
policies/functions/ACLs match the source. SQL syntax, RLS execution, effective
privileges, transactional behavior and concurrency still need live verification.

For later manual verification, use only an explicitly isolated disposable test
database/project for mutation attempts. Never run destructive assertions against
production or the connected project's existing business records:

1. After the reviewed migration is applied through the normal approved process,
   an administrator may run the existing SELECT-only
   [`phase6a-postflight.sql`](sql/phase6a-postflight.sql) to inspect live RLS,
   policies, ACLs, function ownership/definitions/search_path, and constraints.
   Catalog checks alone do not prove tenant isolation.
2. In an isolated disposable database, create synthetic A/B workspaces and rows,
   with distinct owner sessions and ordinary-member sessions; also test an owner
   of both workspaces. Use authenticated JWT sessions, **not** service-role or
   migration-admin connections as the access-testing identity.
3. Direct authenticated reads of each table with B's workspace filter and A's
   item ID must return no rows. A user without owner access to A must also get no
   A rows by supplying A's ID directly or omitting the workspace filter. This is
   the direct RLS behavior that mocks cannot prove.
4. Call save/delete RPCs directly with B plus existing A IDs; also supply A to an
   unauthorized owner B session. Test updates, products/FAQs `active: false`, and
   deletes for all three entity types. Each must fail, and an independent owner-A
   read must confirm the original rows are unchanged. Test the dual-owner mixed
   tuples in both directions. Business information has no archive action.
5. As an ordinary member, direct table reads and all three kinds of save/delete
   RPC calls must be denied; direct INSERT/UPDATE/DELETE must lack privileges.
   Confirm the valid owner tuple still works, and a revoked/downgraded owner's
   next operation is denied. Destroy only the isolated disposable environment.
6. In the authenticated browser, confirm foreign workspace URLs show an access
   error, workspace switching clears editor state, and normal owner CRUD,
   simulated Agent Studio replies and refresh persistence remain functional.
   WhatsApp sending must remain locked.

## Validation result

All **81 tests passed**, including 24 new isolation/source regression tests and
all existing Phase 5B tests. `npx next typegen`, `npx tsc --noEmit`, and
`npm run build` passed. `npm run lint` passed with no errors and the existing
unused `_cacheHeaders` warning in `src/utils/supabase/server.ts`.
