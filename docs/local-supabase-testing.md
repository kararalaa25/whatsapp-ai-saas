# Local Terminal and real browser testing, without Docker

> **Existing development database compatibility:** use
> [the current exact SQL order](existing-development-migration.md) for the
> user-confirmed platform catalog collision. Do not run the original Phase 8
> installer on that database. The current application uses the separate Wasla
> plan catalog and ingestion RPC described there. Earlier results below are
> historical and do not establish the hosted schema state.


Use a **separately authorized development Supabase target** with synthetic data.
For this compatibility branch, verify the platform and Phases 4–6A baseline first
using [the existing-development guide](existing-development-migration.md). An empty
project needs its real reviewed platform baseline; do not create placeholder
platform tables merely to satisfy the installer. The
Next.js app runs on your computer; Auth/PostgREST/database run in that development
project. This avoids the Phase 9B local Docker capacity blocker but is **not** an
offline/local Supabase stack. No hosted target was contacted during preparation.
Creating/configuring that project and executing its SQL remain human actions with
target-specific authorization. Never substitute an existing shared project.

## Prepare the project and local app

1. Use [the existing-development SQL order](existing-development-migration.md) to
   verify the supplied baseline and apply 7A, 7B and the compatible Phase 8 installer
   after target-specific authorization. Do not run the original Phase 8 file. Do not link the CLI, run
   `supabase db push`, or reuse a production `.env`/service-role credential.
2. In the dedicated project's Auth URL configuration, set the local site origin
   to `http://localhost:3000` and allow the exact callback
   `http://localhost:3000/auth/callback`. Use the same hostname throughout; do not
   alternate `localhost` and `127.0.0.1` during PKCE tests. Avoid wildcard redirects.
   This is a project setting, not a reason to change a shared project's URLs.
3. Decide the test email-confirmation path. With confirmation enabled, use only
   controlled synthetic test accounts/inboxes and the development project's
   permitted email service. In the same browser/profile that signed up, follow
   the standard confirmation link back through `/auth/callback` for PKCE exchange.
   If using the existing token-hash endpoint instead, configure the development
   confirmation template to point to `/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
   on the local site origin, rather than expecting `/auth/confirm` to accept a PKCE
   code. Verify invalid/reused links fail. Do not screenshot or log link tokens.
   With confirmation disabled, signup may immediately set a session but deliberately
   still displays a neutral check-email acknowledgment; navigate to Dashboard or login.
4. Require a modern Node LTS supported by Next 16 (Node 22 or 24) and npm. Use a
   fresh checkout of the reviewed integration branch:

   ```sh
   git clone --branch integration/phase8-existing-dev-compatibility https://github.com/kararalaa25/whatsapp-ai-saas.git wasla-dev
   cd wasla-dev
   npm ci
   touch .env.local
   chmod 600 .env.local
   # Open .env.local in your local editor; never paste keys into shell history.
   npm test
   npm run typecheck
   npm run lint
   npm run build
   npm run dev -- --hostname 127.0.0.1 --port 3000
   ```

   Visit `http://localhost:3000`. Keep the server loopback-only; no tunnel or public
   preview is needed. `npm ci` requires registry access; production build fetches
   Google Geist fonts. An unavailable registry/font host is an environment failure,
   not successful validation. The production build does not require Supabase keys
   or contact the database. `npm run typecheck` generates Next's route/layout
   types before invoking TypeScript; plain `tsc` on a clean checkout can fail
   with missing `LayoutProps` until `next typegen`, `dev` or `build` runs.
   For signup on plain HTTP use **`npm run dev`**: signup
   explicitly allows an HTTP local app origin only in development. Do not diagnose
   `next start` on HTTP as a Supabase failure or weaken the origin check.

### Environment variables — names only

Required in local `.env.local` for the browser/application:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL`

Use only that dedicated project's API URL and **publishable** key. Set the app
origin to the localhost origin described above. A publishable key identifies the
project; it is not a user session or an administrator credential. `.env*` is ignored;
never commit local files. Restart Next after edits. `NODE_ENV` is managed by Next.

Optional **smoke harness only**, supplied in a private local environment file:

- `WASLA_DEV_PROJECT_REF`
- `WASLA_DEV_TARGET_CONFIRMED`
- `WASLA_SMOKE_ACCESS_TOKEN`
- `WASLA_SMOKE_OWN_WORKSPACE`
- `WASLA_SMOKE_FOREIGN_WORKSPACE`
- `WASLA_SMOKE_ROLE`

Existing optional provider/webhook variables, **leave unset for this preparation**:

- `OPENAI_API_KEY`
- `SUPABASE_WEBHOOK_SECRET_KEY`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_TEST_PHONE_NUMBER_IDS`

No payment, Vercel, DB-password, Meta access-token or service-role variable is
required for signup/onboarding/dashboard/demo testing. OpenAI mode makes real
provider calls when configured: leave it unavailable. Webhook ingestion needs a
privileged server credential; do not configure one for this manual browser pass.
No env flag enables outbound transport or billing. Do not set real provider keys.

## Read-only real API smoke checks (opt-in, not run in preparation)

The [checker](../verification/integration/read-only-smoke.mjs) performs only GETs:
anonymous workspace denial, private-schema non-exposure, real Auth `/user` JWT
validation, own/foreign workspace filtering and selected feature-table SELECTs.
It never signs up, refreshes a session, calls a PostgreSQL function or writes a row.
It logs labels/status only, not keys, JWTs, IDs, response bodies or customer text.

First manually confirm the project reference matches the **new dedicated development
project** in Dashboard. Set both confirmation variables to that same reference;
the checker accepts only the exact HTTPS `<reference>.supabase.co` origin. It rejects
legacy JWT keys, secret keys, custom domains and local emulator URLs intentionally.
This assertion prevents accidental URL drift, but **cannot prove a project is
disposable or that fixture data is synthetic**. Human verification is mandatory.

After real browser login, get only the synthetic user's current access JWT using
local DevTools/session tooling. Keep it in a mode-600 ignored local file, outside
shell history and evidence. Configure known, distinct own and foreign synthetic
workspace UUIDs; foreign workspace must actually exist and not be shared with this
user. For member tests, configure the member's own workspace and set the role to
`member`; default is `owner`. Do not use service-role tokens or copy browser cookie
storage blindly (SSR cookies may be chunked/encoded). Never attach a raw HAR or
trace with session tokens to a PR. Revoke test sessions after use.

```sh
# .env.smoke.local is private/ignored and contains the harness variables plus
# the development URL/publishable key. Do not use a production env file.
chmod 600 .env.smoke.local
node --env-file=.env.smoke.local verification/integration/read-only-smoke.mjs
```

Exit 0 means these limited reads passed; 1 means a check failed; 2 means blocked or
incomplete (including absent JWT/empty own fixtures). Empty inbox/draft fixtures do
not prove owner access. Missing relations/schema-cache errors fail. Results do not
prove RPC authorization, SSR refresh/revocation, concurrent quotas or browser flows.
The harness's automated tests use explicit response fixtures, not authentic sessions.

## Synthetic fixture preparation for inbox/member/expiry scenarios

Signup and onboarding create workspaces through the real UI. There is no client
number-claim, invitation or inbound-message composer; blank inboxes alone cannot
verify inbox workflows. A trusted administrator must prepare synthetic fixtures
only after separately confirming the dedicated target. Never import customer data.

- Create owner A, owner B and member C via real Auth signup/login, not fake SQL
  `auth.users` rows. Onboard A and B in separate isolated browser profiles.
- To test a member/above-capacity backfill, after migrations 1–4 and **before 8**,
  an administrator can add C's real synthetic Auth UUID as `member` to A's synthetic
  workspace. Use an explicit verified workspace/user ID and `role='member'`.
  Then apply 7A/7B/8 in order. After 8 the trial's one-member capacity must block
  an additional membership; do not bypass it to make a fixture. Client invitations
  and team-management UI are not implemented. Do not claim those features passed.
- For an inbox fixture on a fully migrated dedicated target, the administrator
  can execute this **write template** after replacing the UUID and unique suffix.
  It calls the trusted ingress RPC directly and **does not prove webhook signature
  verification**. No Meta account, credential, webhook subscription or send is used.
  Do not execute this on a real/shared workspace or replay a conflicting source ID.

  ```sql
  BEGIN;
  -- Replace with the UUID of A's synthetic workspace; verify it in Dashboard.
  INSERT INTO public.whatsapp_connections
    (workspace_id,phone_number_id,waba_id,is_test,status)
  VALUES ('<synthetic-workspace-uuid>','900000000000001','900000000000002',true,'active');
  SELECT public.ingest_wasla_whatsapp_test_message(
    '900000000000001','900000000000002','wasla-dev-inbound-<unique-run>-1',
    'text','What are your opening hours?',now(),'900000000000003');
  COMMIT;
  ```

  Trial permits one connection. Before inserting, verify none exists; if the
  connection is already prepared, skip INSERT and use its synthetic IDs. Do not
  use ON CONFLICT to obscure mismatched ownership. Save the exact timestamp and
  payload privately if testing an exact duplicate: `now()` on retry changes
  identity and must fail. Add another unique text for the **same** sender to test
  stale drafts. A different sender tests a new metered conversation.
- Expiry/capacity fixtures require separately reviewed administrator changes on
  dedicated synthetic workspaces or waiting for a real deadline; no public expiry
  control exists. For expiry, move the trial/period deadlines to the past while
  preserving trial plan, record an explicit local audit reason, then verify effective
  denial without paid activation. Never set an active paid plan to unblock tests.
  Use the Phase 9A scenario definitions as behavioral references, **not** its Auth
  stubs/SQL bridge against hosted Supabase. Hosted concurrency remains an open gate.

These fixture writes are instructions for a later authorized test, not part of the
GET-only smoke checker and not executed in this branch's preparation.

## Authenticated browser checklist and evidence

Use two browser profiles/incognito contexts for A/B, a third for C and a signed-out
context. Test desktop and 390px mobile viewports, keyboard focus and English/Arabic
content. Record each result as PASS/FAIL/BLOCKED/NOT TESTED with commit, UTC time,
environment label, steps, expected/actual and sanitized screenshot reference.
Store artifacts privately with test accounts only; exclude cookies, passwords,
confirmation links, raw HAR/session storage. Do not mark a row PASS before observing it.

| Workflow | Actions and expected result |
| --- | --- |
| Signup/confirmation | Real synthetic signup, password mismatch/invalid form, confirmation path, invalid/replayed link; neutral response; no open redirect; session survives callback/navigation |
| Login/logout | Wrong password gives generic error, correct login reaches dashboard; logout then protected URLs redirect to login; Back/reload must not disclose private content |
| SSR refresh | In a synthetic session wait beyond access-token expiry, navigate protected pages; confirm refresh cookies persist and private/no-store headers; repeat with invalid/absent refresh cookie, fail closed; do not print headers containing tokens |
| Revocation | Revoke synthetic session, refresh/reload; document that locally verified access JWTs may remain usable until expiry. `getClaims()` is not immediate server revocation. Confirm refresh fails; do not claim immediate revocation unless observed/enforced |
| Onboarding | New user sees onboarding; English/Arabic name creates workspace plus owner, trial and disabled automation transactionally; reload persists selection; invalid name rejected |
| Workspace isolation | Switch only A's memberships; tamper `workspace` query to known B UUID, malformed UUID and duplicate parameters on dashboard and every feature route; no B name, counts, messages or data; repeat with C and signed out |
| Knowledge / demo | Owner adds synthetic hours/product within trial quota, saves agent with previews enabled; New playground and Demo use own knowledge, label simulation, no OpenAI network call; provider option unavailable with key absent |
| Inbox list/detail | Use trusted synthetic inbound fixture, filter/paginate/open/read history; assign to an existing same-workspace member (or self); foreign assignee denied; close/reopen preserves human control |
| Takeover/drafts | Takeover blocks AI/automation; manual draft only where entitled; release explicitly, create simulated draft, edit/approve locally; no sent/delivered message or outbound request. New inbound in second tab makes old source stale and approval fails |
| Automation | Defaults disabled; opt into draft-only on entitled trial; owner explicitly processes verified text; repeat token/source cannot duplicate draft; human request goes pending human; no worker or automatic send |
| Billing | `/dashboard/billing?workspace=<uuid>`; four provisional plans, NULL prices unconfigured, monthly/annual comparison, usage; upgrades and payment disabled. `&lang=ar` gives RTL and Arabic labels, English switch works; member/foreign owner denied |
| Expiry/quotas | Expired/over-cap synthetic fixture keeps history, blocks additions/new conversations/AI provider reservations/draft creation and automation; no paid activation or trial reset; existing customer inbound history can append |
| Deferred intake | New-customer expired/quota fixture persists raw/intake but not new conversation; owner sees `/dashboard/intake?workspace=<uuid>` including `&lang=ar`, 25-row pages; member/foreign denied; reconciliation reports bounded work/cooldown without granting entitlement |
| Errors | Missing schema/cache, auth outage and stale revisions return safe unavailable/error states, no success toast or accidental retry-created duplicates; do not break a shared project to simulate faults |

Server-action mutations must independently enforce owner access; a hidden button
is not evidence. Test unauthorized actions using real member/foreign sessions in
an authorized harness, inspecting the exact current action/RPC contract. Check
privileged RPCs and private sequences via real PostgREST/administrator ACL review.
The GET checker does not exercise those writes. Leave them NOT TESTED if no safe
fixture/harness exists. Do not use raw credentials in curl command lines.

## Eventual Vercel readiness (not a deployment instruction)

After real integration evidence and owner acceptance, separately review merge and
deployment authorization. The app uses the three required public env names above;
environment scopes must point to the intended dedicated staging target initially.
An eventual HTTPS app origin and exact Auth callback allowlist must agree. Keep
server credentials out of `NEXT_PUBLIC_*`, leave providers unset, verify runtime
cookies/no-store headers and production error behavior, and protect preview access.
No Vercel project linking, environment upload, deployment, domain configuration or
provider activation was performed or authorized here.
