# Cloud pre-staging verification — 15 November 2026

Starting point: `b09e46bdfaac71f8dafd4d6f95ef50f8971ac45f`, branch `integration/phase8-existing-dev-compatibility`.

**Decision: local database and sandbox verification completed; staging sign-off remains blocked on actual Supabase Auth/PostgREST/browser acceptance, approved Meta assets/provider testing and retention decisions.** No hosted database, credentials, deployment, WhatsApp transport, payment service or production data was accessed. No source release gate was enabled.

## Pending hosted migration and order

The owner-confirmed applied schema remains Phase 4–6A, 7A/7B and compatible Phase 8. No replay of old migrations/postflight is requested. The only pending hosted schema file in this verification is:

`supabase/migrations/20261114221600_cloud_business_runtime.sql`

Future operator sequence, **after explicit permission to access/write the chosen hosted development target**:

1. Backup/recovery review and `docs/sql/cloud-runtime-preflight.sql` (read-only).
2. New Cloud migration above, once, transactionally.
3. `docs/sql/cloud-runtime-postflight.sql` (read-only); actual PostgREST schema-cache visibility and role tests.
4. Aggregate monitoring using `docs/sql/cloud-runtime-monitoring.sql`; authenticated browser acceptance; separately approved provider activation.

Local execution below was independently authorized by the current task. It is not hosted execution and does not justify running the file on shared development automatically. Previously applied migrations were not edited.

## Exact disposable environment

- Existing cached image: `postgres@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07`; image ID `sha256:140936e8665d5274aa58df31b722693b4b451c541bb0f1a263a345d424bfacb4`.
- Local Docker context pinned to `unix:///var/run/docker.sock`. New unique run-labeled container only; `--pull=never`, **network none**, no port bindings, no host mounts, read-only root. Data in bounded 512 MiB tmpfs, socket/temp each 16 MiB, 1 GiB memory, PID limit 256.
- Every SQL invocation verifies the container isolation/label, a newly created database allowlist, Unix-socket target (`inet_server_addr() IS NULL`) and disposable database name. No remote URI or environment credential is accepted.
- Two fresh databases per Cloud run: full selected compatible chain, Cloud preflight/install/postflight/monitoring, replay rejection, initial false/zero/pilot-empty defaults, preservation of existing platform catalog and every pre-existing public/private function definition. All rows are synthetic.
- `anon`/`authenticated` are NOLOGIN/non-BYPASSRLS; service_role has BYPASSRLS to exercise ACL protection. Deliberately permissive default grants model Supabase risks. `auth.users` and `auth.uid()` are **SQL fixtures**, not GoTrue or JWT verification. Test-only Cloud pilot flags/limits are enabled solely inside disposable fixtures.
- Only this run's verified container is removed. No image/volume/network pruning, shared daemon configuration or unrelated resource deletion. Recorded run results include isolation, engine version, migration hashes and cleanup evidence.
- Node 24.22.1, npm 11.9.0, Next 16.4.6. No new dependency install was required. A full official Supabase stack was not provisioned; this small PostgreSQL run does not clear the documented Phase 9B storage/tooling gates. No image pull or remote fallback was attempted.

## Results

| Check | Result | Scope |
|---|---|---|
| Cloud PostgreSQL integration | PASS, 22 tests | Real SQL roles, RLS, ACLs, constraints, transactions and concurrent connections; synthetic Auth claims |
| Existing compatibility PostgreSQL regressions | PASS, 30 tests | Existing Phase 7/8 ingress, automation, subscription/security/concurrency; separate fresh disposable run |
| Application tests | PASS, 312 tests, no skips | Includes 71 Cloud sandbox cases; mocks do not prove provider integration |
| TypeScript | PASS | `npm run typecheck` |
| ESLint | PASS | `npm run lint` |
| Production build | PASS | `npm run build`; no deployment |
| SQL grammar | PASS | 62 SQL statements and 22 PL/pgSQL function bodies; actual binding also exercised by DB cases above |
| Actual Supabase Auth/JWT/PostgREST/SSR cookies | NOT TESTED | SQL role switching is not an authentic session |
| Authenticated browser workflows | NOT TESTED | Previous public-browser evidence remains historical; no new UI implementation or browser claim |
| Real Meta onboarding/delivery/status callbacks | BLOCKED | Needs approved assets/configuration and explicit registration/send authorization |
| Real Iraqi Arabic voice accuracy | BLOCKED | Needs approved provider budget/consent, representative recordings and native-speaker evaluation |
| Hosted migration/security parity | NOT TESTED | No hosted reads or writes; local results do not prove unknown hosted settings |

Sanitized evidence: `verification/cloud/database-results.json`, `verification/cloud/compatibility-regression-results.json`, `verification/cloud/prestaging-results.json`. Local verbose logs under ignored `work/`: `cloud-database.log`, `cloud-compat-regression.log`, `prestaging-tests.log`, `prestaging-types.log`, `prestaging-lint.log`, `prestaging-build.log`.

Database cases cover owner A/B/member/anonymous denial, service direct-table and private sequence denial, default function ACLs/search paths, tenant-specific knowledge retrieval and composite FKs, no direct paid upgrades, same-source concurrent deduplication, last conversation/AI unit races, combined legacy/Cloud phone races, quota/expired intake retention and other-workspace progression, projection rollback, audio reservation/start idempotency and lease binding, stale unprojected input rejection, takeover/manual reply/reconciliation/release, signup actor/workspace state binding, confirmed-email invite retries/removal and manual subscription review without activation. Provider send/statuses are simulated SQL transitions; no HTTP request to Meta occurs.

## Confirmed defect fixed

Actual PostgreSQL raised **42702 ambiguous column** in `manage_cloud`'s release guard: table alias `d` collided with the function's PL/pgSQL `d` draft variable. PostgreSQL evaluates that expression on the takeover/release branch, so this could block takeover as well as release. Renamed the SQL join alias to `pending_draft` in the still-pending Cloud migration. Tests now execute both takeover and the uncertain-delivery release guard, reconcile with synthetic evidence, and release successfully.

Initial runner startup was also corrected to wait for the final PostgreSQL PID rather than its transient initialization server. Test expectations were corrected for the documented next-poll processing of superseded messages and the required revision refresh after an uncertain send. A knowledge fixture was corrected to supply existing NOT NULL catalog fields; no schema relaxation was made. These harness corrections are not application defects. All final results above come from completed reruns.

## Release-gate audit

- `CLOUD_INSTALLATION_APPROVED=false` and `CLOUD_PROVIDER_RELEASE_APPROVED=false` remain source constants. Runtime service-client construction requires installation approval; production provider IO and worker processing require provider approval before requests/paid work. Environment variables and tenant settings cannot turn those gates on.
- Legacy Phase 7B outbound transport still throws unconditionally. Billing event acceptance still throws; no payment adapter or activation writer was added. Manual subscription review remains `approved_pending_activation`, leaving subscription status/plan unchanged.
- New RPC grants distinguish owner-facing authenticated functions, service-only worker/intake/token/audio functions and operator-only private reviews. No anonymous execution, client private table/sequence access or service direct-table privilege is introduced by the new schema. Real local catalog/denial tests verify these assertions.
- This verification supplies no hosted endpoint/credential to its database harness and performs no hosted write. Existing application knowledge/onboarding persistence is **not globally removed**; future users with a configured legitimate Supabase session can still use the existing authorized app. Do not interpret the Cloud source gates as a universal firewall for arbitrary service credentials outside this runtime.
- Webhook HMAC-before-parse, bounded durable batch processing, source replay, encrypted token/AAD/rotation, media SSRF/type/hash/size/duration, transcription ambiguity and takeover are covered by existing sandbox tests. Real CDN/provider responses, acoustic accuracy, OAuth behavior and ingress redaction remain acceptance gates.

## Actions requiring the owner

1. Approve a dedicated real Supabase integration target/credentials and actual Auth/PostgREST/SSR/browser verification. Hosted schema installation needs its own explicit approval and target/backup review.
2. Follow [exact Meta setup](meta-developer-setup.md): app verification/access review, scopes, configuration ID, eligible staging WABA/number, HTTPS callback `/api/webhooks/meta`, privately generated verify token, message subscription and consenting test recipient. Generated dashboard test numbers are not automatically compatible with Embedded Signup.
3. Approve registration/subscription/provider AI-STT and specific test sends before a separate release-gate commit, pilot limits and scheduling. No approval is inferred from setup documentation.
4. Decide voice retention/expired-media recovery, transcript consent/provider handling, queue SLA/monitoring ownership and acceptable Arabic-first/history pagination pilot limitations.
5. Execute and record [staging checklist and E2E matrix](staging-cloud-checklist.md). Do not merge/deploy or claim commercial readiness from these local results alone.
