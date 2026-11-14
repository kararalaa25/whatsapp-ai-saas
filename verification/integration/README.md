# Integration preparation tools

Current schema: `public.wasla_subscription_plans` and
`public.ingest_wasla_whatsapp_test_message`. Use the
[existing-development SQL order](../../docs/existing-development-migration.md),
not the original Phase 8 installer.

Start at [readiness report](../../docs/integration-readiness.md),
[manual SQL runbook](../../docs/manual-supabase-migrations.md) and
[local Terminal/browser guide](../../docs/local-supabase-testing.md).

`read-only-smoke.mjs` is an **opt-in GET-only** real API checker. Never run it
against an existing shared/production project. Its explicit project-ref assertion
is an accident guard, not proof of isolation. It accepts only the dedicated
project's publishable key, and optionally a synthetic user's access JWT. No
service-role key, database URI or provider credential is accepted/needed.

The preparation did not invoke it with a real target. Run its fixture tests offline:

```sh
node --test tests/integration-smoke.test.mjs
```

After an operator verifies a dedicated development target and fixtures, follow
the private environment-file instructions in the guide. Exit statuses: 0 all
limited checks passed; 1 failed assertion; 2 blocked/incomplete. Empty own fixtures
cannot prove allowed access. Real write/RPC/session/browser scenarios require the
separate manual matrix. Do not treat the five fixture tests as integration results.

`docs/sql/integration-inventory.sql` and `integration-postflight.sql` are read-only
SQL Editor tools, not migrations. The latter requires the full chain first. No
automatic migration/bootstrap/deployment or destructive cleanup command is added.
