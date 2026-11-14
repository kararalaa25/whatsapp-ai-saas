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
