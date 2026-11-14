# Phase 9A — isolated integration, security and database verification

## Decision and provenance

**Recommendation: keep PR #1 draft.** The PostgreSQL migration/RLS/ACL/intake/
quota/automation scenarios below passed on a disposable target. No application
or schema defect requiring a production-code change was confirmed in these cases.
Real Supabase Auth/PostgREST/SSR and authenticated responsive browser verification
remain open, as do rollout, retention and saturation/recovery policy approvals.
These results do not authorize merge, deployment, production migration or activation.

Verification branch: `verification/phase-9a`, worktree `/workspace/wasla-phase9a`.
Base: Phase 8 PR head `e5f44b43d84dcfe5e49f66a8657132982339193e`.
Refreshed main at start: `7f8cb2014185dd9275f0145929fe200b961b9849`.
The Phase 8 worktree was clean. Main, the Phase 8 branch and the original checkout's
untracked interrupted auth/dashboard work were preserved. Fixes here concern the
verification harness/fixtures and reproducible evidence only. No historical or
pending application migration file was edited.

Read before testing: `AGENTS.md`, roadmap, Phase 7A/7B/8 docs and Phase 8 merge review.
The earlier documents' statements about no SQL execution describe their own phases;
**this phase executed SQL only inside the isolated fixture described below.**

## Exact environment and safety proof

| Item | Verified value / scope |
| --- | --- |
| Host tool environment | Debian GNU/Linux 13, x86_64 |
| Runtime tools | Python 3.12.14, Node v24.22.1, Docker Engine 29.9.2 |
| Docker endpoint | Explicit default context, `unix:///var/run/docker.sock` |
| Image | Official `postgres`, pinned manifest `sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07` |
| Image ID | `sha256:140936e8665d5274aa58df31b722693b4b451c541bb0f1a263a345d424bfacb4` |
| Database engine | PostgreSQL 17.12, Debian `17.12-1.pgdg13+1`, 64-bit |
| Container | New unique `wasla-phase9a-<run>` name and ownership label checked before schema writes |
| Network | `none`; no published ports or host-data/volume bindings |
| Filesystem | Read-only root; bounded tmpfs data, socket and temp paths; 1 GiB memory / 256 PID bound |
| Data target | Newly created `wasla_phase9a_suite` and `wasla_phase9a_repeat`, synthetic data only |
| SQL channel | `docker exec` → `psql -X` → container Unix socket; `inet_server_addr() IS NULL` checked |
| Authentication fixture | Minimal `auth.users(id)` / `auth.uid()` and anon/authenticated/service_role roles; no Auth server or JWT validation |
| Default privileges | Intentionally permissive grants across schemas, requiring application revocations to work |
| Cleanup | Owned containers removed after tests; tmpfs databases discarded; no verification containers remain |

The runner accepts no external DB URL, credentials, project reference or existing
container/database. It verifies the local endpoint, unique ownership label,
network/port/mount/tmpfs properties and target database namespace. Only databases
it successfully created enter its allowlist. Marker/run-ID checks also protect the
Node SQL bridge. Docker context selection is explicit. No local host database,
shared Supabase endpoint or production data was queried, even read-only. Only the
public image registry and repository remote were used outside the test container.

No payment, OpenAI or WhatsApp API call occurred. Synthetic HMAC/credential labels
exist only inside test module overrides; no application/production credential was
configured, printed or committed. Trust auth is confined to the networkless test
container and is not a recommended deployment setting.

Reproducer: [runner instructions](../verification/phase9a/README.md).
Machine-readable final evidence: [results](../verification/phase9a/results.json),
including engine/isolation, source migration hashes, test names and cleanup result.

## Migration and integration results

The exact chronological chain was applied, unchanged, to disposable databases:

1. `20261114000000_workspace_foundation.sql`
2. `20261114010000_whatsapp_test_foundation.sql`
3. `20261114020000_ai_agent_playground.sql`
4. `20261114030000_business_knowledge_catalog.sql`
5. `20261114040000_whatsapp_conversation_inbox.sql` (Phase 7A)
6. `20261114050000_whatsapp_automation_draft_engine.sql` (Phase 7B)
7. `20261114180000_phase8_subscriptions.sql` (Phase 8)

The upgrade fixture seeded a workspace/owner, test connection, verified inbound
history and 30 products after the first four migrations. The final three migrations
backfilled inbox state, disabled automation settings and one trial while retaining
history and catalog records above the initial 25-product capacity. A second empty
database applied the same entire chain successfully. Phase 7A/7B/8 preflight and
postflight scripts executed at their appropriate stages under read-only transactions
on both targets: **12 successful script executions**. The test-only history table
supports those scripts; this is raw SQL application, not Supabase CLI verification.

Replaying the already-applied Phase 8 file was rejected at the existing-object
boundary. Subsequent data checks remained intact. This is **not** a claim that SQL
files are idempotent or safe to replay. A real migration system must use its history;
repeat setup here always creates another disposable target.

## Actual PostgreSQL and route/database results

**28 database test cases passed, 0 failed.** These executed migration functions,
RLS, ACL checks, real row locks/transactions and concurrent psql sessions, rather
than substituting a modeled quota/queue implementation.

| Area | Result and observed behavior |
| --- | --- |
| Onboarding/backfill | New workspace gets trial, owner and disabled automation; existing above-cap catalog and source history retained |
| RLS | Owner A cannot read B's workspace/subscription/inbox/automation rows; ordinary member retains only the intentionally older own-tenant raw monitor access |
| RPC authorization | Member/foreign owner/anon/service contexts denied unauthorized billing, intake, reconciliation, generation and legacy ingress paths |
| Private data / ACLs | Counters, reservations, events, invoices, intake, controls and identity sequence reject client access; catalog checks show no private table SELECT/INSERT grants |
| Definer ownership | Application definer functions are postgres-owned with empty search paths in the fixture |
| Upgrade/payment hard stops | Client subscription updates, private transition activation and forged billing writes rejected; no events accepted |
| Normal / expired / quota intake | Verified raw rows persist, new-customer projection defers at quota/expiry, existing-customer history continues, other tenant remains independent |
| Duplicate / collision | 16 simultaneous identical deliveries create one source/projection; global ID collision across tenants rejected |
| Conversation last unit | Eight concurrent new customers with one unit yield one conversation and seven durable deferred messages |
| Transaction rollback | Injected projection fault leaves raw/intake durable while conversation and monthly reservation changes roll back |
| Reconciliation | 25-row limit, one-minute call limit, five-minute event cooldown, five-fault stop, recovery after injector removal and customer source ordering observed |
| Intake/reconcile race | Concurrent webhook/reconciliation preserves one authoritative projection per source; later reconciliation drains any deferred remainder in order |
| Saturation | 1000 outstanding records retain their sources; the 1001st deferred event rolls back acceptance with `54000`; an existing customer's next event still commits |
| Disabled mapping | Verified event retained, projection deferred; trusted synthetic reactivation permits later reconciliation |
| AI duplicate / concurrency | Eight same-revision calls consume one unit; last-unit races admit only the available quota |
| Original daily cap | Shared owner cap across two workspaces admits one request at 49/50; rejection rolls back monthly usage/reservations |
| Monthly replay | Prior-period operation key stays idempotent; a new operation uses the current UTC monthly bucket |
| Capacity | Concurrent product additions stop at 25; expired edits preserve history; disabled numbers still consume allocation; tenant reassignment denied |
| NULL/grace | NULL access denies capacity; grace cannot be repeatedly extended through the trusted transition contract |
| Automation | Simulated local completion is idempotent; no AI-provider units or delivered state created; takeover, source changes and expiry block stale completion/approval |
| Automation retries | Generating lease retry replaces token; old token fails; maximum three automation attempts observed |
| Foreign sources/assignees | Cross-workspace source and assignee substitutions rejected |

The real webhook route and ingestion adapter also ran against PostgreSQL through a
test-only **direct SQL RPC transport**, with real Request/Response and HMAC checks.
Nine bridge checks cover normal acceptance, expiry/deferred + existing-customer
batches, duplicate replay, signature rejection before DB invocation, a transport
failure with later batch progress, retry after partial batch success, saturation
with later acceptance, and a lost RPC response **after commit** followed by an
idempotent retry. This is an in-process route/database bridge, not PostgREST or a
browser/network deployment. The model-based regressions remain a separate layer.

Two harness issues were corrected while developing the suite: fixture membership
must respect the one-member trial cap (it now seeds a temporarily configured second
member then restores the cap), and snapshot selection must identify the most recent
synthetic conversation rather than tie on source position across customers. Initial
fixture/startup failures were not counted as application passes. No application
schema defect was confirmed by the final tested cases.

## General regression and static results

| Check | Result |
| --- | --- |
| `npm test` | 212 passed, 0 failed (existing mock/model/unit/render tests) |
| `npm run lint` | Passed; zero errors, one pre-existing `_cacheHeaders` warning in `src/utils/supabase/server.ts:15` |
| `npx --no-install next typegen` | Passed |
| `npx --no-install tsc --noEmit` | Passed |
| `npm run build` | Passed; production route compilation/page generation, including intake |
| SQL grammar | Migration bodies actually parsed/executed by PostgreSQL; offline parser also checked the unchanged migration chain |
| `git diff --check` | Passed |

No real model-output quality, external provider compatibility or production-scale
performance claim is made. Race tests are finite regression scenarios, not a proof
against every possible schedule or deployment configuration.

## Browser and Supabase platform scenarios still unverified

No local Supabase CLI/Auth/PostgREST stack was available; the provisioned fixture is
plain networkless PostgreSQL with synthetic auth primitives. It cannot issue real
Supabase sessions, serve PostgREST embedded joins, verify JWTs or exercise SSR
cookies. Connecting the UI to a shared Supabase service would violate this task.
An invented browser session or mocked login would not close that gap. Therefore
**no authenticated browser pass is claimed** and these remain merge gates:

- Local synthetic signup/login/logout, confirmation and SSR refresh/cache behavior.
- Owner/member workspaces, switching, URL tampering, revocation and onboarding under
  actual Supabase API/JWT/claim semantics.
- Inbox list/detail joins and pagination, takeover, assignment, refresh, local draft
  edit/approve/discard and stale errors through actual server actions/PostgREST.
- Draft-only automation preferences, rate/lease errors and human-request handoff.
- Billing English/Arabic/RTL at desktop/mobile sizes, trial/expired/past-due states,
  retained history and disabled pricing/payment controls.
- Expired-owner intake paging, cooldown and review-needed states; foreign/member
  rejection; post-reconciliation refresh; missing-schema and ambiguous-response UI.

Run these later only against a separately proven disposable full Supabase stack.
Do not configure shared/production credentials or use real customer accounts.

## Trial/backfill and expiry policy review

The tested migration grants existing and new workspaces one configurable trial,
initially 14 days. Backfill does not clear business data, mint provider usage or
seed paid status. Reconciliation and webhook retries do not restart trials or extend
periods. The original per-owner abuse limits remain independent of workspace plans.
Synthetic admin fixtures set active/past_due states solely to test boundaries;
there is no application/payment activation capability.

After expiry, existing history and owner backlog inspection remain available,
existing-customer inbound can append, and new conversation processing/drafts/AI/
automation stay gated. New verified text can be retained up to the separate intake
safety capacity. Monthly rollover does not restore an expired trial. Paid activation
and renewal are disabled, so **there is no customer self-service recovery path**.
Before any real rollout, approve the pilot duration, trial communications, who may
perform exceptional recovery, its audit/review rules and a separately implemented
recovery mechanism. Do not solve saturation by self-assigning a paid plan, replaying
migrations or silently extending every trial.

## Saturation / 503 / recovery runbook (prepared, not deployed)

1. **Detect:** monitor webhook 2xx/4xx/503 rate and latency, database RPC failures,
   per-workspace outstanding count and oldest age, failure/retry-exhausted counts,
   processed rate, reconciliation rate limits and storage headroom. Count deferred
   acknowledgments separately from processed events. Do not log bodies, phone IDs,
   HMACs, credentials or GET verification tokens; redact proxy/access logs too.
2. **Warn early:** proposed pilot thresholds are 800/1000 outstanding (warning),
   950/1000 (urgent) and 1000/1000 (saturated). These are reviewable operational
   suggestions, not configured alerts or promised support SLAs. Approve owners,
   alert routing and age/latency thresholds before activation.
3. **Classify:** distinguish subscription/expiry deferral, disabled mapping, failed
   predecessor, processing fault, full intake and database/transport outage. Use
   authorized tenant-scoped inspection; preserve source IDs and correlation hashes
   without exporting customer text to general telemetry.
4. **Acknowledge truthfully:** normal deferred 200 means committed retention. A 503
   means at least one event was not accepted (or its response was ambiguous); later
   events may already be committed. Expect whole-batch retries and do not duplicate
   them manually. At hard capacity/storage failure, upstream retries have a finite
   lifetime; there is no unlimited-lossless-intake guarantee.
5. **Restore safely:** correct infrastructure or trusted mapping faults; review
   eligibility rather than bypassing entitlements. Eligible owners can reconcile
   at most 25 events once/minute with five-minute per-event cooldowns. Retry-exhausted
   records need a diagnosed, separately authorized administrator correction. Never
   purge accepted sources, reset counters/dedup keys blindly or mass-reset attempts.
6. **Verify recovery:** compare raw sources, intake terminal state and unique source
   projections; verify no duplicate customer positions or tenant moves. Check new
   eligible and existing-customer messages, later batch progress, oldest backlog
   age and fresh 503 rate. At full eligibility, 1000 records require at least 40
   successful 25-row reconciliations; this phase has no automatic worker.
7. **Escalate before retry exhaustion:** an approved capacity/retention plan and
   incident owner must exist before live ingress. If safe recovery requires shared
   access, production credentials, quota-policy changes or provider actions, stop
   and obtain that separate authorization. This verification performs none of them.

## Privacy, monitoring and retention requirements

Intake references the original bounded raw body instead of copying it, but sender
IDs, customer text, drafts and knowledge snapshots are personal/business data.
Approve retention duration, deletion/export requests, least-privilege operator
access, encryption/backups, audit access retention and telemetry redaction before
real usage. The 1000 bound applies to unresolved text intake, not all historical
raw/processed records. No automatic cleanup or compliance policy is implied.
Monitoring configuration and production access-control/backup verification remain
future operational work, not enabled by these test results.

## Migration rollback / recovery considerations

All supplied migrations are transactional. The fixture verified complete cold
setup, populated upgrade and rejected replay. It did not test production-sized
locking windows, online schema changes, real backup restoration or disaster recovery.
Before any authorized rollout, rehearse the exact chain and backup/restore on a
separate disposable environment with representative synthetic volume.

If application/schema compatibility fails after a committed migration, prefer a
reviewed forward correction with matching app code. Do not edit applied files,
blindly rerun Phase 8, restore its older raw-only ingress grant, use DROP CASCADE,
disable RLS, remove intake metadata or reset usage/dedup history. Accepted-but-
unprojected rows need their sender/order metadata for safe later recovery. Preserve
raw/intake/usage/audit records in a separately authorized protected backup before
any recovery intervention. A pre-migration restore can lose subsequently accepted
events, so coordinate ingress, app version and replay/reconciliation policy first.
No rollback, restore or shared data change was performed here.

## Remaining decision gates

The tested PostgreSQL gate is satisfied **for this exact synthetic PostgreSQL 17.12
fixture and scenarios**. Keep PR #1 draft until disposable full-stack Auth/
PostgREST/browser verification and operational trial/recovery/retention signoff are
complete. Re-fetch the PR head and rerun after any integration changes. This branch
contains a reproducible verifier and evidence, not permission to merge or activate.
