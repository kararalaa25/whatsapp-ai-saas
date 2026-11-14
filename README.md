# Wasla AI · وصلة

A workspace for Iraqi businesses to maintain business knowledge, inspect verified
WhatsApp test conversations, prepare grounded reply drafts and monitor subscription
usage. Arabic-first account entry and dashboard, with English dashboard/recovery
and bilingual subscription/intake views.

**Development review build:** WhatsApp sending, automatic delivery and real payments
remain disabled. Self-service Meta onboarding, team invitations and live delivery
status/retry processing are not complete. Do not describe this build as a live
commercial messaging service.

## Run locally

Use Node 22 or 24 and the committed npm lockfile:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Run type generation/build sequentially; both write Next's `.next` output. Open
`http://localhost:3000`. Password/signup callbacks permit an HTTP app origin only
with `npm run dev`, not a production server on HTTP.

Create a private, ignored `.env.local` using only the approved **development**
project. Required variable names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL`

Never put a secret/service-role key in a public variable. Leave `OPENAI_API_KEY`,
`SUPABASE_WEBHOOK_SECRET_KEY`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and
`META_TEST_PHONE_NUMBER_IDS` unset for provider-free UI tests. No provider or
production credential is needed for unit tests/build/public pages.

## Database and Auth

The owner confirms 7A, 7B and compatible Phase 8 have been applied in development.
**Do not rerun migrations or the original conflicting Phase 8 file.** The current
catalog is `public.wasla_subscription_plans`; current bounded ingress RPC is
`public.ingest_wasla_whatsapp_test_message`. Platform billing tables stay separate.

For Auth setup, the project owner must allow the exact app-origin callback paths
`/auth/callback` and `/auth/recovery`. Signup uses PKCE callback exchange; recovery
uses PKCE or a recovery-only token-hash template. See
[readiness and remaining manual checks](docs/mvp-readiness.md). No Auth settings
or hosted data are changed by running this repository's automated tests.

## Verify

- `npm test`: real application actions/renderers with explicit external/DB mocks;
  SQL source assertions are not live PostgreSQL security proof.
- `npm run typecheck`: generates Next route types before TypeScript.
- `verification/browser/public-smoke.mjs`: public loopback UI checks only, with an
  independently installed Playwright driver and Chromium. Read the browser README.
- `verification/compatibility/results.json`: **historical** disposable PostgreSQL
  evidence; do not rerun its migration harness in the present no-migration task.

Real signup/email delivery/JWT/PostgREST/SSR/workspace browser integration must be
verified separately with synthetic accounts. Mocked sessions cannot close that gate.

## Structure

- `src/app`: account entry, dashboard, knowledge, inbox, automation, billing/intake.
- `src/utils`: request-scoped authorization, AI/knowledge, ingestion, billing contracts.
- `tests`: unit/action/security contract regressions.
- `supabase`: historical schema sources and the compatible manual installer.
- `verification`: explicitly scoped database/browser evidence and tools.

[Current readiness report](docs/mvp-readiness.md) is the release checkpoint.
No automatic migration, deployment, merge, payment activation or outbound send is
authorized or performed by these instructions.
