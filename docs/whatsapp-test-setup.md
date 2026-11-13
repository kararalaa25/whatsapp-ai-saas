# Phase 5A: inbound Meta test environment

This is receive-only scaffolding. No Graph API send operation, AI reply, media
download, production-number support, or browser token entry is implemented.
Use synthetic messages and your own opted-in developer recipient only. Do not
use real customer messages or production WhatsApp credentials.

## Prerequisites and credentials

The workspace foundation and `20261114010000_whatsapp_test_foundation.sql`
were already applied manually in the existing project. **Do not rerun either.**
Phase 5B adds a separate migration, described in `ai-agent-preview.md`; review
and separately authorize that migration before testing the updated ingress.
No migration or setup instructions were executed by the agent.

Configure these variables securely on the server (for local development use
an ignored `.env.local`; never commit it):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing public browser/user-session key |
| `META_APP_SECRET` | App secret from the **developer test app**; HMAC verification |
| `META_WEBHOOK_VERIFY_TOKEN` | A fresh high-entropy random value you choose and also enter in Meta's webhook setup |
| `META_TEST_PHONE_NUMBER_IDS` | Comma-separated Meta **test** phone-number IDs, not display phone numbers |
| `SUPABASE_WEBHOOK_SECRET_KEY` | Server-only Supabase secret key or legacy service-role JWT for this project; never use a `NEXT_PUBLIC_` prefix |

Existing authentication still needs its existing app-origin configuration.
Restart the dev server after changing variables. Missing webhook configuration
fails closed with 503. Do not print credentials or callback query URLs in logs.
Next.js development incoming-request logging is suppressed for this webhook
path, because GET verification contains the verify token in the query string.
Configure any tunnel, reverse proxy, hosting provider and APM to omit/redact
webhook query strings and request bodies too; application code cannot control
those external logs. Do not enable request/body tracing for this endpoint.

No Meta access token is needed to verify or receive these webhooks. Meta's API
Setup panel may show a temporary token; do not paste it into this app or its
tables. If outbound integration is added later, design dedicated server-side
secret storage and rotation first.

The webhook Supabase credential is privileged and can bypass RLS in general.
Its sole code path calls the service-role-only ingestion RPC. The migration
revokes direct webhook-role privileges on the two new tables. Browser dashboard
reads always use the user's session and membership RLS, never this credential.

## Provision a verified mapping (administrator only; not automated)

1. In Meta for Developers, use a developer/test app with the WhatsApp product.
   Locate its Meta-provided test number, **Phone number ID**, and **WhatsApp
   Business Account ID**. Verify this is the test asset, not a production number.
2. Independently verify the intended workspace and its owner. After the new
   migration is separately approved/applied, provision one row in
   `public.whatsapp_connections` with that `workspace_id`, `phone_number_id`,
   `waba_id`, `is_test=true`, and `status='active'`, using the trusted database
   administrator. No user-facing connection-registration RPC is provided.
3. Put that exact phone-number ID in the server test allowlist. The boolean
   `is_test` and allowlist are operator assertions; this code does not query Meta
   to prove an asset is a test number. Administrators must verify this fact.
4. Do not reassign a connection that already has messages to a new workspace.
   Disable it to stop ingestion. Provisioning, disabling, retention and deletion
   are administrative operations, not browser-write capabilities.

## Local webhook verification

1. Run `npm run dev` on the machine used for local authentication testing.
2. Make **only the webhook path** reachable through an HTTPS tunnel/reverse proxy
   you control: `https://<test-host>/api/webhooks/whatsapp` -> local port 3000.
   Meta cannot call localhost directly. Do not expose dev tools or a debugger.
   A webhook tunnel need not change the localhost authentication callback origin.
3. In Meta's webhook configuration enter the HTTPS callback URL and the same
   verification token. The GET handler accepts `hub.mode=subscribe`, checks the
   token, and returns only the numeric `hub.challenge` with HTTP 200.
4. Subscribe the test WABA/app to `messages` using Meta's current developer UI.
   Verify the subscription applies to the test assets identified above.
5. Send a synthetic text message **from your own developer WhatsApp recipient to
   the Meta test number**, using the official test setup. Do not implement or use
   this SaaS to send a WhatsApp message. Generic Meta sample payloads with dummy
   IDs may be acknowledged but intentionally ignored.
6. Sign in, select the mapped workspace, and open its WhatsApp test page. Refresh
   to see the received text. Confirm another workspace/user cannot read it.
7. Replay a signed delivery in a controlled test: the same Meta message ID must
   remain one row. Do not publish signatures or payloads in terminal output.
   Invalid signatures must receive 403; malformed signed events receive 400.

## Trust boundary and delivery behavior

- Route: GET/POST `/api/webhooks/whatsapp`; no browser session required.
- POST reads at most 1 MiB of raw bytes, verifies `X-Hub-Signature-256` using
  the app secret, then decodes/validates JSON. No raw message logging.
- Only allowlisted test phone IDs reach storage. The RPC independently matches
  **both phone-number ID and WABA ID** against an active test connection and
  derives the workspace from that row. Payload workspace IDs are ignored.
- Global Meta message-ID uniqueness plus `ON CONFLICT DO NOTHING` makes storage
  duplicate-safe, including concurrent deliveries. Existing content is never
  overwritten. A failed batch returns 503: retries deduplicate earlier inserts.
- Valid status-only, unallowlisted, unknown-mapping and disabled-connection
  deliveries are acknowledged without storing messages. Monitor mappings during
  setup: HTTP 200 alone is not proof a message was persisted.
- Text is stored up to 4096 Unicode code points. Non-text events store only an
  unsupported-type marker, ID and timestamps; no contact profiles, raw payload,
  attachments, or media downloads are stored. Phase 5B additionally uses the
  signed test sender ID to isolate new text histories per connection/customer;
  see `ai-agent-preview.md`. Keep even test content synthetic.
- GET challenge verification does not prove ongoing connectivity. No automatic
  replies, background polling, message sending or production-ready rate limiting
  is included. Before wider exposure add edge rate limits, retention/deletion,
  operational monitoring without sensitive logs, and review secret management.

## Validation

Run `node --test tests/*.test.mjs`, `npm run lint`, `npx tsc --noEmit`, and
`npm run build`. Automated tests use mocks, not a live database or Meta service.
The SQL was only statically reviewed. Before claiming readiness, separately test
the applied migration with authenticated users in two workspaces, direct-write
denial, service-only RPC execution, mapping mismatch/disabled connections, and
concurrent duplicate delivery against real PostgreSQL. Do not use a privileged
SQL Editor session alone to claim RLS enforcement.
