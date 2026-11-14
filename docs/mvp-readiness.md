# Wasla AI MVP checkpoint — 15 November 2026

**Decision: NOT ready for staging sign-off, a business pilot or a complete
commercial MVP release; suitable only for an isolated development/staging review.** Full authenticated Supabase/browser
verification and several core live-service workflows remain incomplete. No merge,
deployment, provider activation or SQL execution occurred in this work.

Working branch: `integration/phase8-existing-dev-compatibility`. Audit baseline:
`1a583a3b3ada5a6240c42ec7969fff1d73e57135`. Billing-response fix: `eb77673`. Recovery/Arabic entry and regression changes:
`b537cb270075159980acc99ec9249a18020be2cb`.
The owner confirms 7A/7B and compatible Phase 8 are already applied and subscription
functions present. That is accepted; no migration or postflight repetition is requested.

## Implemented and verified progress

- Replaced the Next template homepage/metadata with a branded, responsive Arabic
  entry point and accurate notices that sending/payments remain disabled.
- Reworked the dashboard into Arabic/English navigation to existing workspace
  tools. Removed unfinished Customers/Settings tiles and misleading coming-soon
  copy. Workspace selection/authorization remains request-scoped.
- Added password recovery request, fixed PKCE/recovery-OTP callback, password-update
  form and caller-only update action. Requests have neutral acknowledgments;
  duplicate/invalid inputs and unsafe origins are rejected. Updates require Auth
  `getUser()`, not form-supplied identity/role. Sign-out failure after a confirmed
  password change is reported honestly. No real email was sent during testing.
- Added Arabic-first signup/login/onboarding labels, English recovery option,
  pending/error feedback and a private dashboard error boundary.
- Shared strict app-origin validation between signup/recovery. Suppressed Auth
  code/token query logging in Next development logs as well as webhook tokens.
  Production ingress/APM must independently redact these URLs.
- Hardened billing RPC JSON with runtime validation: correct workspace binding,
  valid statuses/deadlines/plan catalog/counters, no arbitrary workspace override,
  and unavailable states for malformed contracts or transport failures.
- Added billing, recovery, signup, onboarding, SSR-cookie and dashboard regressions.
  Retained all outbound/payment hard stops. Removed the unused SSR callback
  parameter without changing cookie writes or cache-header responsibilities.

## Feature status

PASS below means the stated local boundary was observed, not live certification.

| Feature | Status | Evidence / outstanding work |
| --- | --- | --- |
| Public entry, account forms and recovery UI | PASS | Real local browser at mobile/desktop; Arabic RTL, navigation/validation, English recovery and safe failures |
| Signup/login/logout and email verification | PARTIAL | Actions implemented; mock regression coverage, no fresh real Auth/SMTP/JWT/session test |
| Password recovery/update | PARTIAL | New action/callback security tests and public browser errors pass; real SMTP, PKCE cookies, reuse, policy/CAPTCHA and session revocation unverified |
| Workspace onboarding and authorization | PARTIAL | Real server actions tested with mocks, role/owner spoofing rejected; existing tenant guards tested; actual authenticated browser onboarding unverified |
| Knowledge and AI | PARTIAL | Tenant-grounded demo, Iraqi Arabic/English clarification/handoff and prompt boundaries tested; real provider quality/latency not exercised; provider key absent |
| Inbox/manual drafts/human takeover | PARTIAL | Existing safe-mock/route regressions pass; local approval never delivery; authenticated browser permissions/state races remain open |
| Phase 8 trial/status/access | PARTIAL | Deadline/NULL grace/status logic and RPC contracts pass locally; applied database state is owner-confirmed, not newly verified here |
| Usage/quota/idempotency/concurrency | PARTIAL | Current models and source assertions pass; historical disposable PostgreSQL evidence exists but no database harness/migration was rerun in this task |
| WhatsApp signed test intake/deferred recovery | PARTIAL | HMAC, trusted mapping, compatibility RPC, retries/deduplication/batches/expiry/overflow modeled and tested; no live provider webhook |
| Draft-only automation | PARTIAL | Safe simulated owner processing/handoff/stale completion tests pass; real authenticated flow unverified |
| Arabic/English deep application UI | PARTIAL | Account entry/dashboard improved; billing/intake bilingual; inbox/agent/knowledge still contain English labels and need full authenticated RTL review |
| Self-service Meta connection and live outbound/status/retry pipeline | BLOCKED | Production onboarding, secure token lifecycle and delivery/status implementation are unfinished, in addition to Meta approval/credentials; sending remains hard-disabled |
| Team invitations/membership administration | BLOCKED | Stored roles/owner gates/assignment exist, but invitation/transfer/removal workflows are not implemented and need reviewed schema/authorization work |
| Paid subscriptions/payments | BLOCKED | Provider contract and previews only; no verified adapter, activation, renewal or manual paid-activation path; client cannot self-upgrade |
| Operations/pilot | BLOCKED | Retention/consent, backlog monitoring/recovery ownership, trial communications and provider retry-window response need owner acceptance and operational implementation |

## Test evidence

Environment: Debian 13, Node 24.22.1, npm 11.9.0, Next 16.4.6. Installed application
versions checked with `npm ls --depth=0`; dependency manifest/lockfile unchanged.
The temporary Playwright installation is outside the repository.

- `npm test`: **241 passed**, no failures/skips (217 baseline + five billing
  regressions + nineteen account/onboarding/UI/SSR cases). These include explicit
  mocks and SQL-source assertions, not authentic Supabase sessions.
- `npm run typecheck`: passed. `next typegen` and build must run sequentially on
  one worktree; a preliminary parallel run raced on generated route types, then
  the sequential check passed. No application type error remains.
- `npm run lint`: passed with **zero errors and zero warnings**.
- `npm run build`: passed, including recovery callback and both new account routes.
- `npm audit --omit=dev --json`: zero known production-dependency advisories in
  the returned registry report. This does not prove application security.
- `node verification/browser/public-smoke.mjs`: **ten public-flow observations
  passed** at 390/1440px with Playwright/Chromium and blocked external browser
  requests. The local server had Supabase/provider variables removed. Screenshots
  and scoped results: [browser evidence](../verification/browser/README.md).
- `git diff --check`: passed. No SQL/migration files changed.

Regression tests first reproduced billing's arbitrary-field override and malformed
response acceptance, then passed with the fix. Initial browser-selector failures
were harness issues with cached hidden route DOM/Next's announcer; final checks
use the visible route's form and retain their original behavioral assertions.
No final unexpected failed check is hidden or counted as passed.

## Security and database boundaries

RLS, existing platform billing tables, source uniqueness, trusted tenant mapping,
private service execution and subscription triggers were not modified. Dashboard
reads use the authenticated request client; the privileged ingress client remains
server-only. Payment acceptance and WhatsApp sends still throw unconditionally.
No plaintext provider credential store or unsigned webhook was introduced.

The added password flow uses existing Supabase Auth APIs, no schema writes or
privileged credential. Global sign-out revokes refresh sessions but already-issued
access JWTs may remain valid until expiry; neither this UI nor `getClaims()` promises
immediate access-token revocation. Auth project rate-limit/CAPTCHA/email settings,
SSR persistence and private caching still need genuine integration verification.

No live database check was executed, and success of the already-applied migration
is not treated as proof of runtime RLS/quotas. Existing 30-case disposable PG and
nine route/SQL checks in `verification/compatibility/results.json` are **historical**.
No production/customer data, shared SQL, new migration or database reset was used.

Read-only live checks still needed, through actual synthetic owner/member/foreign
JWTs without printing tokens or bodies:

1. `GET /auth/v1/user`: real identity accepted; absent/expired token rejected.
2. `GET /rest/v1/wasla_subscription_plans?select=id,provisional`: four provisional
   Wasla plans visible to authenticated users, separate from the platform catalog.
3. `GET /rest/v1/workspace_subscriptions?select=workspace_id,plan_id,status,trial_ends_at,period_ends_at,grace_ends_at&workspace_id=eq.<synthetic-workspace-uuid>`:
   own owner sees one row; foreign owner/member sees zero; anonymous denied/empty.
4. Existing opt-in GET-only smoke tool covers additional private-schema/non-owner
   feature reads. Its project-ref acknowledgment is not proof of isolation.

These are outstanding runtime reads, **not another request for postflight SQL**.
They cannot prove quota races or successful mutation workflows; those require a
separately authorized synthetic integration session, not writes in this task.

## Staging preparation and next engineering checkpoint

Build instructions/environment names are in README. Before any separately
approved staging deployment: use the intended development project in scoped
staging environment variables; run checks sequentially; configure an HTTPS app
origin and exact callback allowlist; protect preview access; validate proxy cookies,
private no-store headers and sanitized errors. Keep all provider keys unset for
provider-free staging review. No Vercel project was linked or deployed here.

Required names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_APP_URL`. Existing optional provider/server names (leave unset here):
`OPENAI_API_KEY`, `SUPABASE_WEBHOOK_SECRET_KEY`, `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, `META_TEST_PHONE_NUMBER_IDS`.

Recovery needs the exact `/auth/recovery` callback on the configured app origin,
in addition to existing `/auth/callback`. Standard PKCE email links should return
to that callback in the originating browser. For a token-hash recovery template,
use `/auth/recovery?token_hash={{ .TokenHash }}&type=recovery` on the configured
origin, not the signup-only `/auth/confirm`. Verify real SMTP/rate/CAPTCHA behavior,
invalid/replayed links and refresh-cookie persistence before customer use.

Next coding tasks after the authenticated test gate: reviewed team invitation/
revocation flow; official Meta onboarding and token vault lifecycle; durable outbound
intent/status/retry implementation kept disabled until approved; full deep-page RTL;
then an audited payment adapter and monitoring/retention operations. These are
unfinished engineering work, not problems credentials alone can solve.

Shortest owner-only actions:

1. Configure/approve the development Auth origin/callbacks and email settings,
   keeping credentials private; authorize a controlled synthetic Auth/browser test.
2. Decide trial recovery, retention/consent and pilot operations; obtain official
   Meta sandbox approval and choose billing provider/commercial terms when ready.
3. Separately approve staged schema/integration changes and eventual staging
   deployment after the unverified gates close. No migration replay is needed.

No PR was created or merged. The current branch remains the review/checkpoint
artifact; passing local checks alone does not authorize production or pilot traffic.
