# Phase 5B playground refresh investigation

## Confirmed defect and fix

Investigated remote main at `874e7a265e412fbf6ae8b63c6b8e89fa5d9bf873`.
The initial local checkout was older and contained untracked auth files; it was
left untouched. Work was performed in a separate checkout.

`studio.tsx` calls `newConversation(workspace)` from New playground. That action
checks owner access, invokes `create_ai_playground(p_workspace_id)`, then calls
`readConversation` and returns its snapshot. The UI adopts that snapshot. Demo
is a provider choice independent of persistence: `previewReply` with a selected
conversation reads its revision, generates a simulated reply, invokes
`save_ai_turn`, and reloads the saved messages. Only a null conversation ID takes
the temporary, non-writing branch. Failed creation displays an error and does
not adopt a saved conversation.

The confirmed defect was refresh restoration: the selection and transcript were
only React state, initialized to null and an empty array. The page loaded settings
and the latest 30 conversation summaries but no selected transcript. Thus refresh
returned to temporary mode even after a successful saved turn. This establishes
a UI restoration bug, not deletion of database rows or an RPC failure.

The fix records the selected ID in the `conversation` URL parameter on creation
and selection, retaining the verified workspace. The request-time page loads it
through the existing owner-authorized reader and initializes the studio with the
snapshot. Reset temporary demo removes the parameter. Invalid, duplicated,
inaccessible, or missing selections render an unavailable state rather than
silently allowing temporary replies. Component keys include workspace and
selection so navigation cannot reuse another conversation's local state.

## Access, cache, and error review

- `loadDashboardState` checks authenticated claims and own workspace membership;
  explicit invalid or foreign workspace selection is rejected without fallback.
- `requireAgentOwner` rechecks claims and the selected workspace's owner membership.
  Every action calls this path using the request-scoped authenticated client.
- Conversation and message reads explicitly filter workspace ID, and messages
  additionally filter conversation ID; latest 20 messages are reversed for display.
- Migration source defines owner-only SELECT RLS, composite tenant foreign keys,
  RPC-only writes, and ownership checks inside both creation and turn RPCs.
  `save_ai_turn` checks open status and revision under a row lock. These are static
  source findings; live database policies, grants, and RPCs were not queried.
- The page awaits `connection()` and clients read request cookies; no shared
  conversation cache or `use cache` wraps these queries. No evidence justifies
  adding cache invalidation as a persistence fix.
- Creation/read/save errors already return safe UI errors. A successful creation
  followed by failed read can leave a stored conversation without adopting it;
  this remains a possible runtime failure, not an established cause here.
- WhatsApp outbound code and its unconditional sending block are unchanged.

## Verification and remaining runtime evidence

Tests execute real action functions and real component handlers with mocked React
hooks and a persistent in-memory Supabase stand-in. They cover creation, adoption,
a saved demo turn, URL preservation, a fresh panel/component load, transcript
restoration, another saved turn after reload, temporary reset, tenant rejection,
read errors, creation errors, and page search-parameter forwarding. They do not
claim live browser or database end-to-end verification. Existing tests also cover
auth failures, membership revocation, revision conflicts, and blocked delivery.

If a conversation is missing from Saved conversations as well as the active
playground, the confirmed UI defect alone does not establish why. To distinguish
that case, collect the following from the affected authenticated browser/server:

1. The workspace UUID and conversation UUID returned by New playground, the URL
   before and after refresh, and whether the studio showed a saved title or the
   Temporary demo label before generation.
2. The server-action result for New playground (including whether its readback
   failed) and for Generate reply preview. Confirm preview received the saved
   conversation UUID rather than null. Browser requests are Next.js server actions;
   Supabase RPC traffic occurs server-side, so browser network capture alone may
   not expose the RPC details.
3. Sanitized server-side Supabase results: create_ai_playground return value/error
   code; save_ai_turn workspace/conversation UUIDs, revision, and error code;
   ai_conversations and ai_messages read results/errors for that workspace and ID.
   Never capture cookies, bearer tokens, credentials, or customer message content.
4. An authorized database administrator's evidence that the same workspace and
   conversation rows exist, and authenticated owner reads can see them with the
   current grants/RLS. Also note whether the conversation falls outside the latest
   30 summaries. No SQL or live database operations were executed in this task.

Validation: `node --test tests/*.test.mjs` passed all 39 tests;
`npm run lint` passed with the existing `_cacheHeaders` unused-variable warning
in `src/utils/supabase/server.ts`; `npx next typegen` followed by
`npx tsc --noEmit` passed; `npm run build` passed. Initial standalone TypeScript
checking required generated Next.js route types. The initial build attempt used
a dependency symlink outside the Turbopack root and failed package resolution;
copying the existing installed dependencies into the isolated checkout resolved
that environment issue without changing package files or application config.
