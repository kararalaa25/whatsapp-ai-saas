# Existing-development compatibility verification

Run only with the local cached pinned PostgreSQL image and installed npm
dependencies:

```sh
python3 verification/compatibility/run_database.py
```

No image pull is performed by this runner. It accepts no remote URL, password,
project reference, existing database or container. It reuses the Phase 9A isolation
checks: unique labeled container, explicit local Docker socket, network none,
no ports/host mounts, read-only root and bounded tmpfs database/socket/temp paths.
Every SQL invocation checks the container and allowlisted newly created database.
Cleanup removes only that run's container; no existing Docker resource is pruned.

Selected chain: first six files in `supabase/migrations/`, then
`supabase/manual/20261114180000_phase8_existing_development.sql`. The original
Phase 8 file is intentionally tested as a conflicting installer and rejected;
it is not applied as part of this chain. Do not run both variants on one target.

The platform fixture has empty tables with a deliberately different plan schema,
identity columns, a subscription FK, two policies and a function depending on the
platform catalog. Full catalog snapshots check platform relation/column/policy/FK/
grant preservation. Existing function definitions are compared before 7A and before
8. Retired legacy ingress EXECUTE privileges are separately checked as intentional
revocations. A rollback-only insert checks the original FK remains usable.

Two fresh databases verify the selected complete chain and pre/postflight scripts,
existing tenant/history/over-cap catalog backfill, missing-7B rejection, conflicting
original-installer rollback and replay rejection. Thirty real PostgreSQL test
cases include the 28 Phase 9A cases and two compatibility regressions. The route
bridge uses real signed requests and real SQL but substitutes the RPC transport.
The bridge has an explicit fixed allowlist for the old/current SQL RPC name;
the application adapter must request the new name and compatibility execution
uses that exact new function. This is not PostgREST.

Auth primitives are synthetic SQL stubs, not Supabase Auth/JWT validation. The
platform fixture is representative, not an assertion about unknown hosted column
definitions. Real Supabase Auth/PostgREST/SSR/browser integration remains untested.
Use the manual preflight on the target before any later authorized hosted write.

Generated private run output lives under ignored `work/`; reviewed sanitized
`results.json` records the completed run. File hashes identify the exact tested
selected migration chain. See [manual order](../../docs/existing-development-migration.md)
and [verification report](../../docs/existing-development-verification.md).
