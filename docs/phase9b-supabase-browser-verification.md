# Phase 9B — real Supabase Auth, PostgREST and browser verification

## Decision

**Keep PR #1 draft and unmerged.** The real Supabase/Auth/PostgREST/browser test
category is **BLOCKED by local Docker storage capacity**, not verified successfully.
No mocked session, Phase 9A SQL shim or unauthenticated screenshot is counted as
closing this gate. The available regression/type/lint/build checks pass.

Work is isolated on `verification/phase-9b` in `/workspace/wasla-phase9b`, based on
`verification/phase-9a` at `7bbb1d8fcda7110425feeb9595e9ecdbb4df105f`.
Fetched starting heads matched the request:

- Phase 8: `e5f44b43d84dcfe5e49f66a8657132982339193e`.
- Phase 9A: `7bbb1d8fcda7110425feeb9595e9ecdbb4df105f`.
- Main: `7f8cb2014185dd9275f0145929fe200b961b9849`.

`AGENTS.md`, Phase 9A report/harness, roadmap and the seven migration dependencies
were inspected. Existing worktrees, branches and interrupted untracked auth work
were preserved. No application source or migration file changed in this phase.
No shared Supabase service was accessed. No application schema writes, users,
sessions, payment activation, deployment, WhatsApp sending or merge occurred.

## Exact environment and setup evidence

| Check | Status | Evidence / limit |
| --- | --- | --- |
| Repository/worktree isolation | PASS | New branch/worktree from the requested Phase 9A head; other worktrees unchanged |
| Local Docker availability | PASS | Engine 29.9.2, explicit `unix:///var/run/docker.sock` context |
| Docker storage | FAIL — environment | Driver `vfs`, root `/home/dockerd/.local/share/docker`; image registration reported `no space left on device` |
| Official CLI installation | PASS | Supabase CLI v2.75.0 official Linux amd64 release, checksum verified |
| CLI archive SHA256 | PASS | `e5597462f865d5ac72af0453358e37ecb0d85962ad6914a114a53de847303bde` |
| Dedicated port-binding probe | PASS | Harmless `sleep` container confirmed effective published bindings of `127.0.0.1` only; probe removed |
| Fresh/unlinked project preparation | PASS | Unique local project under ignored `work/stack`; no linked project ref or copied application migrations |
| Default official image registry | FAIL — environment | `public.ecr.aws/v2/` returned HTTP 403 before stack creation |
| Supported Docker Hub fallback | FAIL — environment | Registry override verified in the official CLI v2.75 source; database image registration exhausted Docker's backing storage |
| Complete stack target/isolation proof | BLOCKED | No healthy DB/API/Auth services existed to audit; no SQL was allowed to proceed |
| Browser tooling | PASS — availability only | Playwright 1.62.1; system Chromium 156.0.8078.79 launched headlessly |

Host tools: Debian GNU/Linux 13 (x86_64), Node v24.22.1, Python 3.12.14.
The attempted CLI-selected database image was `supabase/postgres:17.6.1.075`.
Other downloaded test images were `supabase/gotrue:v2.186.0`,
`postgrest/postgrest:v14.3`, `kong:2.8.1` and `axllent/mailpit:v1.22.3`.
Their availability alone is not evidence of a running Auth/PostgREST integration.

The official archive and checksums came from the Supabase CLI v2.75.0 release.
The CLI's supported `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` behavior was
verified in its [official source](https://github.com/supabase/cli/blob/v2.75.0/internal/utils/docker.go).
No unofficial binary, image substitution, hosted project or production credential
was used to bypass the setup failure. The public changelog fetch was HTTP 403;
CLI command help and release source were used to verify tooling behavior.

### Isolation preparation and stopping point

A newly named/labeled network and project were prepared, without linking. The
initial internal-network probe did not publish usable ports on this Docker engine.
It was removed and replaced with a dedicated bridge whose
`com.docker.network.bridge.host_binding_ipv4` was `127.0.0.1`; a harmless container
confirmed the effective binding. This is a localhost-binding control, **not** a
claim of disabled network egress. External auth providers were disabled and only
loopback application/redirect targets were configured in the local scratch config.

Proposed API/Auth and DB ports were 55421 and 55422, with application port 3309.
The local CLI start had no copied application migrations. The next required gate
was to inspect every actual container label, network, effective binding, volume,
DB URI and local status URL before any application schema write. That gate never
completed because the database image could not be registered.

The concrete failure was:

```text
failed to display json stream: failed to register layer:
mkdir .../usr/libexec/sudo: no space left on device
```

This occurred in Docker's graph storage, despite approximately 50 GiB being free
in the project workspace. Workspace free space is not proof of Docker-daemon
backing capacity. The fallback start was interrupted after that error (exit 130),
not treated as a successful or healthy-stack exit. No Supabase test container or
data volume was created, and no app migrations, API requests or Auth account setup
ran. Prepared but unexecuted API/browser scaffolding was kept only in ignored
scratch files and is not delivered as validated tests.

Cleanup removed this run's empty network and four newly downloaded unused test-image
tags. The pre-existing Phase 9A `postgres:17` image was retained. No global prune,
Docker-daemon reconfiguration, existing-volume removal or unrelated cleanup was
performed. Docker-managed partial image-cache allocation may still require an
infrastructure owner's review; it was not forcibly deleted through the host filesystem.
The evidence collector confirms zero remaining project containers, volumes or
owned networks.

## Validation results

| Category | Status | Result |
| --- | --- | --- |
| Existing unit/model/render suite | PASS | `npm test`: 212 passed, 0 failed |
| Lint | PASS | `npm run lint`: no errors; one pre-existing `_cacheHeaders` warning at `src/utils/supabase/server.ts:15` |
| Route type generation | PASS | `npx --no-install next typegen` |
| TypeScript | PASS | `npx --no-install tsc --noEmit` |
| Production build | PASS | `npm run build`, route compilation and page generation |
| Diff hygiene | PASS | `git diff --check`; no source/migration diff from Phase 9A |
| Full local Supabase migration chain | BLOCKED | No verified running disposable Supabase stack; migrations not applied |
| Auth/PostgREST compatibility and API schema reload | BLOCKED | No database/Auth/API stack available |
| Genuine signup/login/logout/refresh/revocation | NOT TESTED | Blocked prerequisite; no sessions were mocked or fabricated |
| SSR cookies/onboarding/server-action authorization | NOT TESTED | No local app server or real Auth session |
| Tenant/JWT/private RPC checks through PostgREST | NOT TESTED | Phase 9A direct SQL evidence is not substituted |
| Authenticated inbox/automation/billing/intake UI | NOT TESTED | No accounts/app server; no authenticated screenshots or traces |
| Arabic/English responsive browser behavior | NOT TESTED | Launching Chromium alone does not test the application |
| Outbound/payment hard stops | PASS — existing regression scope | Existing tests pass and source unchanged; no live provider, checkout or send exercised |

A temporary checkout of the official CLI source under scratch `work/` was initially
included by broad TypeScript/ESLint file discovery. It caused fixture-source parse/
lint errors, not an application defect. That checkout was removed after inspecting
the registry implementation, and the final lint, TypeScript and build reruns passed.
No application type/lint rules were weakened to hide failures.

No application defect is confirmed by unexecuted Auth/browser tests. Conversely,
their absence provides no assurance that JWT/cookie/API/UI integration is correct.
The Phase 9A 28-case PostgreSQL result remains historical evidence for its exact
synthetic-auth fixture; it is not a Phase 9B Auth/PostgREST/browser PASS.

Evidence: [sanitized machine-readable record](../verification/phase9b/evidence.json).
The collector checks local metadata and existing result files only; it does not
connect to any DB/Auth/API. Private setup logs, binaries and scratch configuration
remain ignored and are not committed. No keys, passwords, JWTs, session cookies,
request traces or production data enter the committed evidence.

## Required tests once the environment blocker is resolved

First provide a **separate disposable Docker environment with adequate backing
storage** or have its infrastructure owner increase capacity/use an appropriate
supported storage driver. Do not free space by pruning unrelated resources or
substitute shared Supabase access. Recreate a fresh unique project; reprove all
actual DB/API/Auth bindings, own volumes/network, unlinked state and local URLs
before schema writes. Use official tooling with explicit local flags; do not run
`link`, `--linked`, remote DB commands or a shared connection URL.

Then execute, with independent PASS/FAIL evidence:

1. Apply all seven migrations chronologically from foundation through
   `20261114180000_phase8_subscriptions.sql`, unchanged. Inspect actual Supabase
   role/default ACLs, grants, function exposure, PostgREST schema visibility and
   refreshed cache. Never edit/replay an applied migration to recover.
2. Create synthetic owner A, owner B and ordinary member via real Auth. Exercise
   signup/login/logout, signed JWT validation/forgery denial, refresh rotation,
   refresh-token revocation, access-token lifetime and SSR cookie refresh. Check
   whether previously issued access JWTs remain valid until expiry; do not assume
   logout immediately revokes a signed JWT or claim immediate revocation untested.
3. Exercise actual PostgREST embedded membership/source joins, own/foreign table
   reads and writes, all privileged RPC families, anonymous/member/service-role
   denial, private schemas/sequences, forged prices and paid upgrade rejection.
4. Use actual browser form/server-action flows for onboarding, workspace switching,
   URL tampering, membership revocation, logout and unauthorized action replay.
   Do not inject session cookies or mock Auth responses and call it integration.
5. Verify inbox list/detail, assignment, takeover/release, manual/simulated drafts,
   stale approval, draft-only automation/human handoff and in-flight invalidation.
   Every local approval must remain NOT SENT, with no transport call.
6. Check billing in English/Arabic/RTL at mobile/desktop sizes, trial/past-due/expired
   states, quota warnings and disabled payment/change controls. Capture screenshots
   of synthetic non-secret UI only; network traces may contain session credentials
   and must be sanitized or kept private, not committed wholesale.
7. Ingest synthetic signed webhook batches through the local app and actual service
   RPC. Confirm durable deferred intake under expiry/quota, actual owner pagination,
   reconciliation/cooldown/fault states, foreign/member denial, capacity 503 and
   later batch progress. Measure the full browser → server → API → data → UI path.

## Proposed Iraqi-business pilot policies — owner decisions required

Nothing below is approved or configured. These proposals do not authorize a pilot,
communication to customers, provider credentials or activation.

| Area | Practical proposal | Decision required |
| --- | --- | --- |
| Trial/backfill | Explain the configured 14-day technical default in Arabic/English; current code starts existing tenants' trial at eventual migration application | Approve duration/start timing and whether existing tenants need a separately designed transition policy |
| Trial expiry | Retain bounded inbound/history, stop new entitlement-controlled processing, make the lack of paid self-service recovery explicit | Approve a trusted, audited exceptional recovery policy before any real tenant can expire |
| Support schedule | Display Asia/Baghdad times; do not infer Friday/weekend/holiday coverage or promise automatic replies | Name pilot support and escalation owners, working hours, holiday cover and response expectations |
| Pricing | Keep IQD/USD values clearly provisional/unconfigured and plan changes nonfunctional | Approve commercial prices and future billing work separately; no payment activation now |
| Backlog monitoring | Proposed warning at 800/1000, urgent at 950/1000, incident at 1000; monitor oldest age, failed predecessors and processed rate | Approve thresholds, age limits, recipients, incident ownership and monitoring implementation |
| Retention/privacy | Treat sender IDs, raw text, drafts and knowledge snapshots as personal/business data; minimize telemetry | Choose retention periods, deletion/export handling, backup retention, operator access and audit rules; current history has no automatic TTL |

Draft expiry communication for owner review only (not sent or installed):

> Your trial has ended. Incoming messages can be retained within the safety capacity,
> but new-conversation processing, AI and automation are paused. No replies are sent
> automatically. Contact the administrator to review available options; online
> payments are not enabled.
>
> انتهت الفترة التجريبية. يمكن حفظ الرسائل الواردة ضمن سعة الأمان، لكن معالجة
> المحادثات الجديدة والذكاء الاصطناعي والأتمتة متوقفة. لا تُرسل ردود تلقائياً.
> تواصل مع المسؤول لمراجعة الخيارات المتاحة؛ الدفع الإلكتروني غير مفعّل.

### Monitoring and recovery checklist to approve

- Track webhook status/latency, RPC errors, outstanding/oldest backlog, exhausted
  faults, reconciliation outcomes/rate limits and DB storage. Separate committed
  deferred 200 from processed events. Redact HMACs, verification tokens, keys,
  cookies, sender IDs and bodies from access logs/general monitoring.
- A 503 can represent partial batch success; later events may already be durable.
  Retry the same identifiers through the authorized path, never create replacement
  IDs or blindly duplicate an ambiguous request. Hard saturation still depends on
  the provider's finite retry window; there is no unlimited-retention guarantee.
- Diagnose expiry/quota, mapping pause, predecessor/fault, capacity and infrastructure
  separately. Do not solve backlog by self-assigning paid access, clearing source
  rows, resetting quotas/dedup keys or repeatedly extending grace/trials.
- Owner reconciliation remains bounded to 25 eligible events/call, once/minute,
  five-minute event cooldown and five processing faults. A fully eligible 1000-row
  backlog needs at least 40 successful manual batches; there is no automatic worker.
  Exhausted records require separately authorized, diagnosed administrator recovery.
- Before rollout, rehearse backup/restore, app/schema compatibility and a reviewed
  forward-fix path on disposable data. Preserve raw/intake order/sender/usage/audit
  metadata. Do not edit applied migrations, use DROP CASCADE, re-enable the old
  raw-only ingress grant or disable RLS as recovery shortcuts.

## Remaining merge recommendation

Do not mark PR #1 ready solely from unit/build success or Phase 9A SQL evidence.
Resolve the isolated Docker storage blocker, then complete the real Auth/JWT/
PostgREST/SSR/browser matrix and pilot policy approvals. Re-fetch heads and retest
any changes. Main and PR #1 remain unmodified; this phase neither merges nor deploys.
