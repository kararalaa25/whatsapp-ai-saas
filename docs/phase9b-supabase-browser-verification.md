# Phase 9B — real Supabase Auth, PostgREST and browser verification

## Decision

**Keep PR #1 draft and unmerged.** The real Supabase/Auth/PostgREST/browser test
category remains **BLOCKED on the accessible Docker backend**, not verified successfully.
The follow-up below distinguishes current free space from unsafe `vfs` extraction
headroom and the inability to provision a separate daemon.
No mocked session, Phase 9A SQL shim or unauthenticated screenshot is counted as
closing this gate. The available regression/type/lint/build checks pass.

## Follow-up: read-only storage diagnosis and recovery decision

**Outcome: stop after diagnostics; no further image pull or Supabase start.**
The baseline commit was `1d2f6c3defaf921cfd5c3c1ad0c5c3687e9576a3` on the
same verification branch. This follow-up did not change the default daemon,
application, migrations, existing images/containers/networks/volumes or any database.
There is no application fix requiring a regression-suite rerun here; prior unit/
type/build results below remain historical, not a newly passed integration gate.

### Measured capacity, inodes, quota visibility and inventory

| Diagnostic | Actual observation | Interpretation |
| --- | --- | --- |
| Docker root / driver | `/home/dockerd/.local/share/docker`, rootless Engine 29.9.2, `vfs` | This backend duplicates layer trees instead of using copy-on-write |
| Daemon backing filesystem | `overlay`, 67,586,535,424 bytes total (62.94 GiB) | Measured by read-only bind from the daemon namespace, not inferred from workspace free space |
| Available during first daemon probe | 49,739,751,424 bytes (46.32 GiB) | The filesystem is not currently full; the prior ENOSPC was an extraction-time failure |
| Inodes during daemon probe | 4,194,304 total; about 3,856,405 available | No current inode exhaustion observed; no failure-time inode measurement exists |
| Explicit daemon data-root quota | **NOT EXPOSED**: Docker `DriverStatus` is null; no size quota reported | A stricter user/project/outer quota cannot be ruled out through the permitted interfaces; do not interpret this as unlimited storage |
| Workspace snapshots | Initially about 30 GiB free; later 50,719,891,456 bytes (47.24 GiB) after helper cleanup | Free-space snapshots varied; a different directory is not evidence of a separate larger backing disk |
| API inventory at start/end | One `postgres:17` image, logical size 470,898,038 bytes; zero containers, zero volumes, zero build cache | Pre-existing image ID `sha256:140936e8665d5274aa58df31b722693b4b451c541bb0f1a263a345d424bfacb4` retained |
| Physical `vfs` directories during probe | 11,373,453,312 bytes (10.59 GiB), 20 directories | Includes a temporary diagnostic helper; API virtual image size is not physical VFS allocation |
| Registered image metadata | 14 registered layers; delta sum 470,898,038 bytes; cumulative logical layer-tree sum 3,682,018,810 bytes | Even the existing small image has substantial layer-copy amplification |
| Image metadata / temp allocation | About 1.53 MB / 8 KB during probe | Not the dominant observed footprint |
| New rootless daemon capability | `unshare --user --map-root-user true` fails: `/proc/self/uid_map` read-only | A supported separate rootless daemon cannot be established here |
| Privileged alternative | Effective/bounding capability sets are zero; `NoNewPrivs=1`; `fuse-overlayfs` unavailable | No authorized supported path to a new rootful/COW daemon was demonstrated |

Docker's data root was not directly visible in the command workspace. Two short-lived
helpers used the **already present image**, no network, a read-only root and a
read-only `/inspect` bind. Their entrypoints ran filesystem/stat/layer-metadata
inspection only, **not PostgreSQL**; no schema/user/data writes occurred. Their
Postgres-declared data path was tmpfs, preventing an anonymous data volume. Only
those two newly created, labeled, exited helpers were removed afterward. None of
the resources present at task start was deleted. No prune, image pull, host graph
removal or daemon configuration write occurred.

The physical directory count includes stored layer trees, incomplete/cache state
and temporary helper overhead. The non-API-attributed bytes are **not proven safe
to delete**. No manual orphan classification or graph cleanup is authorized by
this report. Mount metadata did not expose a configurable smaller quota; reading
an infrastructure-enforced quota/configuration would require its owner. The
measured filesystem is an upper bound on usable capacity, not a guarantee against
a stricter quota.

### Actual image metadata and unpacked-sizing model

Only public registry manifest/config JSON and **4-byte gzip-footer HTTP ranges**
were read; no registry image was pulled, unpacked or registered in this follow-up.
The diagnostic helpers cloned only the already cached image into temporary container
layers. Immutable manifest descriptors were checked to confirm gzip layer media types.
All 68 layer-footer requests returned the expected ranges. Measurements target
Linux amd64 image manifests; digests and per-layer sizes are retained in
[storage diagnostics](../verification/phase9b/storage-diagnostics.json).

| Required core image | Layers | Compressed GiB | Uncompressed tar GiB | Cumulative VFS model GiB |
| --- | ---: | ---: | ---: | ---: |
| `supabase/postgres:17.6.1.075` | 54 | 1.121 | 3.409 | 149.870 |
| `supabase/gotrue:v2.186.0` | 6 | 0.023 | 0.048 | 0.170 |
| `postgrest/postgrest:v14.3` | 1 | 0.006 | 0.020 | 0.020 |
| `kong:2.8.1` | 4 | 0.046 | 0.134 | 0.278 |
| `axllent/mailpit:v1.22.3` | 3 | 0.011 | 0.028 | 0.063 |
| **Core total** | **68** | **1.208** | **3.638** | **150.400** |

For tar sizes `u[1..n]`, the no-deletion VFS model is
`sum((n - i + 1) * u[i])`, the sum of all cumulative layer trees. The database's
large layer appears early (layer 10), so many later layers copy that large tree.
Downloading only 1.12 GiB therefore does not establish adequate extraction space.
Container init/writable copies, download/temp files, DB/shadow volumes, app/browser
artifacts and safety reserve are additional. Optional Studio, storage, realtime,
analytics and edge-runtime images are **not** in the core table; the complete
standard stack needs more than this selected core inventory.

These are **estimates**, not a measured fully installed image or a mathematical
minimum: tar headers/allocation overhead, deletions/replacements, hardlinks, sparse
files and shared layers affect real usage. Gzip ISIZE is modulo 2^32 and could wrap
for a larger individual stream. The recorded largest returned layer is 2.55 GiB,
but that alone cannot prove no wrap. The model assumes no deletion savings and
sums images without cross-image deduplication. Nevertheless, a prior real ENOSPC
plus a roughly 150 GiB core VFS model on a 63 GiB filesystem does **not** justify
another pull, even with about 47 GiB currently free. Exact safe headroom for a full
VFS deployment is not established. The current environment cannot safely resume
this stack through its available daemon.

The [offline sizing tool](../verification/phase9b/storage_model.py) reproduces these
figures. Its **five tests pass**; they validate arithmetic/data consistency, not
Supabase integration or a real extraction peak.

### Concrete safe setup recommendation

Provision a **new dedicated disposable Linux VM/environment**, rather than moving
this default daemon's data directory or pruning its existing state:

- Planning allowance: **4+ vCPU, 16 GiB RAM and a 200 GiB SSD with at least 150 GiB
  initially free**, plus ordinary ample inode capacity. These are conservative
  verification budgets, not measured peak usage or vendor minimum requirements.
- Use a supported **copy-on-write** Docker backend (`overlay2` on a suitable
  filesystem, or supported rootless overlay/fuse-overlayfs with working user
  namespaces). Verify the actual selected driver; do not accept silent `vfs`
  fallback. The observed core tar content is about 3.64 GiB before runtime/cache/
  optional-service overhead, rather than the cumulative VFS model above.
- Inventory **all intended official CLI images** on that target before starting
  the complete standard stack. Keep substantial reserve for pulls, shadow DBs,
  writable layers, synthetic volumes and browser/build artifacts. If VFS is the
  only option, first size every selected image and add at least 50% planning
  margin; even this core model alone implies over 225 GiB before further costs.
  Do not retry it on the present 63 GiB filesystem.
- If a second daemon is used on another capable host, give it distinct data-root,
  exec-root, PID file, socket/context and network resources. Do not modify or reuse
  a shared/default daemon's configuration/data root. Merely choosing another path
  on this same constrained filesystem does not add capacity or capabilities.
- Pin/verify the official CLI and image versions; use the supported Docker Hub
  registry setting if ECR remains forbidden. Use a fresh, unlinked project and
  synthetic users only. Bind every published DB/API/Auth/application/mail endpoint
  to loopback; inspect actual labels, volumes, networks, bindings and DB URIs
  before application schema writes. Run browser tests on that disposable host.

No privileged workaround, Docker-in-Docker escalation or unsupported namespace
bypass was attempted. Increasing shared/default daemon capacity or clearing its
cache would require separate explicit infrastructure authorization, not a silent
repair in this task.

### Follow-up status

| Area | Status |
| --- | --- |
| Read-only inventory/capacity/inode/layer diagnosis | PASS — observations recorded, quota visibility limits explicit |
| Existing resource preservation | PASS — original image and default networks retained; no original container/volume existed or was removed |
| Separate supported local daemon/data root | BLOCKED — no usable namespace/capability path demonstrated |
| Safe headroom for full current VFS stack | BLOCKED — not established; no repeat pull |
| Real Auth/JWT/PostgREST/SSR/browser/migrations | BLOCKED / NOT TESTED — not resumed |
| Offline sizing arithmetic/data consistency | PASS — 5 tests |
| Application regressions | NOT RERUN — no application or migration change; prior 212/type/lint/build evidence below is historical |

The requested recovery cannot be performed safely with the available backend and
permissions. Stop at diagnostics and provide the dedicated environment above.
PR #1 remains draft/unmerged; no shared Supabase, credentials, deployment, payment
activation or WhatsApp sending was used.

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
