# Phase 9A disposable PostgreSQL verification

This runner **creates its own test target**. It does not accept a database URL,
existing database, project ref, credential, host or container argument. Do not
adapt it to connect to a shared or production Supabase project.

Prerequisites: a local Docker daemon at `unix:///var/run/docker.sock`, Python 3.12,
Node.js and the repository's installed npm dependencies. Pull the public pinned
image once if it is not available locally:

```sh
docker --context default pull postgres@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07
python3 verification/phase9a/run_database.py
```

The runner verifies the explicit default Docker context, creates a uniquely labeled
container, disables networking, publishes no ports, uses no host/volume mounts,
sets a read-only root and tmpfs for PostgreSQL data/socket/temp files, and checks
those settings before application schema writes and every SQL call. Only databases
created by that run with a fixed `wasla_phase9a_` namespace are accepted. SQL is
executed by `docker exec` and Unix socket, never host psql, a URL or the network.
`psql -X` prevents user configuration loading. No external environment credentials
are passed into the container. Trust authentication applies only to this isolated,
networkless fixture; it is not production configuration guidance.

Two fresh synthetic databases exercise cold setup and upgrade/backfill. All seven
migration source files are read unchanged, in chronological order. Minimal local
`auth.users`, `auth.uid()`, three roles and a test migration-history table stand in
for Supabase platform primitives. Deliberately permissive default grants stress
the application's explicit ACL revocations. These stubs do **not** implement Auth,
JWT verification, PostgREST, SSR cookies, session refresh or production configuration.

The suite runs real SQL/RLS/triggers/transactions and multiple psql processes for
concurrency. Test-only timestamps/configuration, synthetic admin state fixtures and
a projection-fault trigger permit deterministic boundary tests without waiting for
calendar changes or calling providers. `http_database.mjs` executes the real webhook
route and ingestion adapter with a direct-SQL RPC test transport. Its Request/
Response and HMAC behavior are real, but its transport is **not PostgREST** and it
is **not an authenticated browser test**.

At completion, the runner verifies ownership labels and removes only its own
container. Data disappears with its tmpfs. Diagnostics and machine-readable results
are generated under ignored `work/`; the final reviewed evidence snapshot is
`results.json`. A failed run is not a security pass. Review the report and all test
outputs before using its result. Repetition means new isolated databases, not
replaying applied migrations on an existing target.

If a run is externally interrupted, inspect only containers with the
`wasla.phase9a.run` label. Verify that label, network/ports/tmpfs and the originating
run ID before removing that exact resource. Never use global prune/volume cleanup.
