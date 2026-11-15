# Cloud runtime verification

`npm test` includes the three `tests/cloud-*.test.mjs` suites: actual TypeScript
application functions under explicit database/provider mocks, generated audio and
HTTP fixtures, and static SQL contract checks. They do not execute migrations or
prove PostgreSQL RLS, Auth, locking, real acoustic accuracy or Meta delivery.

For public UI checks only, with no `.env.local` or inherited provider/database
credentials, start the loopback development server on port 3210. Install Playwright
outside the repository and run:

```
WASLA_PLAYWRIGHT_PATH=<absolute-package-path> node verification/cloud/public-browser.mjs
```

Chromium is expected at `/usr/bin/chromium`. Browser network is restricted to the
loopback origin. The script tests invitation validation/fragment removal and
unauthenticated redirects at 390/1440px, plus unconfigured endpoint failures.
Screenshots/results go to ignored `work/cloud-browser/`. Committed `results.json`
records scope explicitly; authenticated workflows and real provider tests are not
counted as passed. No migration harness is automatically run by these checks.

See `docs/cloud-runtime-readiness.md` for new pending SQL, exact owner/configuration
requirements, deferred intake and unknown-send recovery, retention decisions and
remaining database/security acceptance tests. Keep both source release gates off
until separately reviewed approval. Never use production/shared services as a test
fallback, enable payments, or send WhatsApp messages through this harness.

## Disposable PostgreSQL integration (explicit local invocation)

```
python3 verification/cloud/run_database.py
```

The runner imports the existing Phase 9A/compatibility isolation helpers. It accepts
no database URL, project, credential, existing container or target switch. It uses
only the cached digest-pinned PostgreSQL image with `--pull=never`; a new unique
run-labeled container has network **none**, no published ports, no host binds, a
read-only root, bounded tmpfs data/socket/temp, 1 GiB memory and a PID limit. It
checks those properties and the database-name allowlist on every SQL invocation.
There is no TCP endpoint: `psql` runs over the container-local Unix socket. Only
the labeled container belonging to this run is removed; shared resources are not
pruned. Output under `work/cloud-database-results.json` records cleanup/isolation.

It installs the selected historical chain in two fresh disposable databases using
the **compatible manual Phase 8 installer**, then the new pending Cloud migration.
The conflicting original Phase 8 installer is rejected by compatibility checks,
not used for setup. Existing platform catalog and function definitions are
compared; Cloud replay is rejected atomically. Synthetic SQL users include confirmed
email fields and a stub `auth.uid()`; roles model anon/authenticated/service_role
including service BYPASSRLS. Test-only pilot flags/quotas are enabled in fixtures,
not in application source or any hosted target.

The suite exercises real PostgreSQL RLS, ACLs, composite FKs, worker state,
concurrent duplicate/last-unit quota/capacity transactions, retained expired intake,
projection rollback, signup binding, invitations, takeover, manual approvals and
monotonic statuses. It makes **no provider call**. It does **not** validate JWTs,
Supabase GoTrue/PostgREST/SSR cookies or authenticated browser workflows. Those
require the separate authorized acceptance checklist. A missing cached image or
failed isolation assertion is a blocker, never a reason to use a remote endpoint.
