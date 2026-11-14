# Phase 9B blocked-environment evidence

No real Auth/PostgREST/browser test is represented as passed here. Official CLI
v2.75.0 was checksum verified and a loopback port-binding probe passed, but the
Supabase database image could not be registered: Docker's `vfs` backing storage
reported `no space left on device`. The default ECR registry also returned 403;
the documented-in-source Docker Hub fallback reached the storage failure.

See `docs/phase9b-supabase-browser-verification.md` for exact PASS / FAIL / BLOCKED /
NOT TESTED results, cleanup, future test matrix and owner policy decisions.

`collect_evidence.py` is a read-only collector for this attempt's existing ignored
`work/` files and local Docker metadata. It does not bootstrap services, connect
to a database, apply SQL, generate users or contact a hosted Supabase project.
`evidence.json` contains only sanitized results, public artifact checksums and
non-secret environment metadata. It contains no credentials or sessions.

A future verifier must provision a new disposable stack and reprove its complete
isolation before migrations. Adequate Docker-daemon storage is required; free
space in the repository filesystem is not sufficient. Do not use a shared endpoint
or global Docker prune to bypass this blocker. No unexecuted API/browser scaffolding
is shipped as a validated test harness.

## Read-only storage follow-up

`storage-diagnostics.json` records the daemon-side filesystem/inode observations,
registered-layer accounting, public registry layer sizes and blocked separate-daemon
probe. Current free space is not reported as zero: the safe extraction headroom
remains unproven because the accessible driver is VFS. The no-deletion cumulative
copy model is about 150.4 GiB for the five core images on a 63 GiB filesystem; it is
an estimate with the limitations explained in the main report.

The following commands are **offline only** and do not use Docker or a registry:

```sh
python3 verification/phase9b/storage_model.py
python3 -m unittest discover -s verification/phase9b -p 'test_storage_model.py' -v
```

The five tests check arithmetic, valid inputs and recorded-size consistency; they
are not Auth/PostgREST/browser tests. No application migration or source was changed.
Only the two newly created read-only diagnostic helpers were removed; all resources
that existed before the diagnostic task were preserved. No graph deletion/pruning
or default daemon configuration change occurred.
