# Wasla AI roadmap

## Phase 7B — draft automation and outbound safety foundation

Implemented: owner-only, workspace-scoped disabled/draft-only preferences;
owner-operated processing of verified inbox texts; grounded Phase 6B simulator;
Phase 7A local draft review and human takeover integration; revision-protected
reservations, idempotency, bounded retry/expiry, rate limits and minimized audit;
unconditionally disabled official Meta transport and future lifecycle contracts.

Delivery is disabled. There are no provider calls, active outbound queue, worker
or automatic replies. Phase 7A and Phase 7B migrations remain unapplied pending
separate review/application and live database verification. See
[Phase 7B documentation](phase7b-whatsapp-automation.md).

## Phase 8 — future development on a separate branch

Proposed scope: review product readiness, team/customer workflows, usage and
operational observability, retention controls and owner review experience. Agree
its concrete scope before implementation. Phase 8 may be developed on its own
branch; this task does not inspect, modify, merge or activate Phase 8 work.
Phase 8 must preserve the outbound hard stop unless a separately authorized
activation milestone explicitly changes it.

## Phase 9 — isolated readiness verification

Proposed scope: live disposable-database RLS/ACL and concurrency verification,
provider-independent failure simulations, model quality evaluations only with
separate authorization, compliance/consent and WhatsApp policy review, monitoring,
incident response, human escalation and operational acceptance. Production
deployment, credentials and real sending remain separate approvals.

## Final activation milestones — each requires independent authorization

1. Review/apply schema dependencies in an authorized test environment; verify
   RLS, grants, direct-RPC defenses and race behavior with synthetic tenants.
2. Approve retention, consent, provider/data handling and WhatsApp policy
   requirements; confirm business-hours/handoff and ownership semantics.
3. Review an official Meta transport implementation and trusted connection/
   credential storage, idempotent durable delivery intent, queue leasing,
   cancellation, retry ambiguity reconciliation and verified status callbacks.
4. Separately authorize credential setup and isolated provider tests with
   explicitly allowed recipients. No test send is authorized by Phase 7B.
5. Validate a controlled rollout plan, limits, monitoring, audit, kill switch and
   recovery procedures. Local approval must still never equal delivery.
6. Separately authorize deployment and, finally, explicit outbound/auto-reply
   activation. Enabling a setting alone must never bypass the reviewed gate.

No milestone has been activated by this roadmap or Phase 7B implementation.
