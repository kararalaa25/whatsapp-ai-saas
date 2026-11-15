# Pre-staging gates and WhatsApp end-to-end acceptance

No deployment, hosted SQL or provider send is authorized by this checklist. Keep the release on hold until all required evidence and approvals are recorded. Do not use production customer data or an existing production number.

## A. Local verification — no external credentials needed

- [ ] Clean expected branch/head; retain unrelated work. `npm ci` only if dependencies are absent.
- [ ] Run `python3 verification/cloud/run_database.py`. It must prove a new labeled networkless tmpfs container, no published ports/host mounts and a fixed cached image before writes. It accepts no URL/project/container argument. Review its result scope: real PostgreSQL, synthetic `auth.uid()` claims, not actual JWT/Auth/PostgREST.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Type generation/build sequentially. No credentials required.
- [ ] Review both Cloud source gates false, private ACL deny tests, old outbound hard stops and payments. Public browser evidence does not establish owner controls work with real sessions.

## B. Approved database sequence

Existing development already has 7A/7B/compatible Phase 8. **Do not replay them or ask for old postflight.** Only the following is pending there:

1. Review backup/recovery and read-only `docs/sql/cloud-runtime-preflight.sql` on the intended target **after permission to access it**. Confirm target/project independently and resolve every missing prerequisite or collision.
2. Obtain explicit hosted-schema-write approval. Then an operator, not this task, runs `supabase/migrations/20261114221600_cloud_business_runtime.sql` once as a transaction.
3. Run `docs/sql/cloud-runtime-postflight.sql`; refresh/check PostgREST schema visibility. Compare grants and verify private schema is unexposed. Do not assume local PostgreSQL predicts unknown hosted defaults/extensions.
4. Test two synthetic owners, an ordinary member and anonymous user through **actual** Supabase Auth/JWT/PostgREST and SSR cookies: own reads succeed; foreign URL/RPC/table reads and all client writes to private/paid state deny. Test logout, refresh, revoked membership and server-action authorization.
5. Evidence existing histories and platform billing catalog unchanged, no unexpected paid activation or trial renewal. If the install aborts, inspect before retry; forward-fix installed defects, never drop tenant data.

For a fresh disposable database, the harness applies workspace foundation, migrations `20261114010000` through `20261114050000`, the compatible manual installer `supabase/manual/20261114180000_phase8_existing_development.sql`, then the new Cloud migration. It excludes the conflicting original Phase 8. This is a test chain, not instructions to replay on development.

## C. Explicit provider-release approval

- [ ] Follow [Meta setup](meta-developer-setup.md); confirm current app eligibility/scopes, callback, verified number/WABA ownership, app subscriptions and token expiry.
- [ ] Approve separate reviewed changes enabling installation/provider gates and tightly scoped pilot feature/quotas/allowlist. Do not activate globally or grant paid plans to bypass quotas.
- [ ] Authorize each external category: Meta registration/subscription, provider AI/STT and **test sends**. Receive a specific consenting test recipient. No real business audience.
- [ ] Configure privileged server secrets privately, key backup/rotation and worker authentication. No secret/service key in client bundles or logs. Ensure callbacks/token query strings are redacted at the actual ingress.
- [ ] Decide voice retention/backlog SLA, deletion/consent and provider data handling before capturing actual audio. Media reference persistence is not permanent audio retention.
- [ ] Configure approved worker scheduling and aggregate alerts for queue age/500/800/1000 saturation, 503s, credential expiry and unknown deliveries. No scheduler/monitor deployment is performed here.

## D. E2E procedure — run only after section C approval

Use two synthetic businesses A/B with different catalog prices/hours, two eligible numbers, separate owners, one invited member and only consenting team recipients. Begin in review mode. Capture sanitized job/draft/attempt IDs and timestamps; redact phone IDs, token values and customer content from shareable evidence.

| Step | Action | Required result |
|---|---|---|
| 1 | Owner A completes Embedded Signup; repeat for B | Actual app/phone/WABA verification, credentials encrypted, separate active channels, review mode. Foreign-owner URL changes deny. Canceled/failed signup never active. |
| 2 | Send an authorized customer text to A asking a known price; ask B the same | Each mapped event durably stored once; each draft uses only that business's knowledge. No outgoing reply before approval. |
| 3 | Replay the signed fixture event in the authorized test environment | Duplicate acceptance; one source/message/quota consumption. Tampered or missing signature rejects before database work. Do not replay a real provider send. |
| 4 | Approve A's current draft once | One dispatch attempt; provider acceptance distinct from sent/delivered/read. Status webhook advances state; duplicate/out-of-order status never regresses or duplicates history. Local approval alone is never labeled delivered. |
| 5 | Receive another message before approving an old draft | Old approval/dispatch rejected even if newer intake is unprojected; latest input becomes reviewable. |
| 6 | Request human help, then owner takeover; separately race takeover against generation | No further AI/provider dispatch after takeover wins the SQL permit. An already permitted/in-flight send cannot be recalled; record that boundary honestly. Human manual reply needs current source/revision, explicit approval and valid service window. |
| 7 | Send short Iraqi Arabic and mixed English voice with known facts/names/prices; test noise/silence | Media hash/type/size/duration verified, transcript evaluated by Iraqi speaker; safe grounded draft or human fallback. Owner playback works, member/foreign owner denies. Never infer accuracy from synthetic transcript mocks. |
| 8 | Exhaust approved synthetic quotas and expire a synthetic trial via separately authorized fixture tools | Intake remains durable; no new paid thread/AI/automation; history remains readable. Other customer/workspace still progresses. Never modify a real subscription as a fixture. |
| 9 | Use failure-injection sandbox for 429, 5xx, timeout and DB commit loss | Bounded known-rejection retry; unknown send held for evidence-based reconciliation, never automatic resend or false delivery. Do not manufacture these failures against Meta production. |
| 10 | Test queued audio aging, queue saturation and worker outage in fixtures | 503 for unpersisted intake, finite retry/monitoring response; old jobs retained. Verify retention policy handles expiring media. |
| 11 | Invite matching confirmed email; retry, revoke/remove and try foreign account | Atomic member cap; no owner escalation, secret exposure or cross-tenant access. Removed membership immediately denies new authorized operations. |
| 12 | Request cancellation, renewal and plan change; withdraw/review | Audit request only; no charge, automatic renewal, trial extension or paid entitlement activation. |
| 13 | Close 24-hour window in fixtures | No free-form dispatch. Unsupported template/outreach workflows stay blocked. |
| 14 | Test credential expiry/revocation and encrypted-key rotation | Generic safe error/reconnect; no plaintext token to browser, no assumed renewal; old ciphertext stays decryptable until verified rotation. |

Record PASS/FAIL/BLOCKED/NOT TESTED separately for every row. Stop on tenant leakage, unauthorized dispatch, lost acknowledged intake, secret exposure or ambiguous delivery being resent. Do not switch the pilot into automatic mode until review-mode acceptance, takeover and quota race tests pass. Automatic mode still needs explicit entitlement and separate operator approval.

## E. Release decision

Staging sign-off requires actual Auth/PostgREST/SSR/browser evidence, local database gates green, approved Meta test results, voice evaluation/retention decisions, alerts/runbook ownership, and no unresolved security defect. English coverage and deep Cloud history pagination remain documented UI limitations; decide acceptable pilot scope explicitly. Payments, production changes and commercial rollout are separate approvals. Keep PR #1 unmerged; this procedure does not authorize merging.
