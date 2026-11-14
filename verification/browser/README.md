# Public browser verification

This is **not** authenticated Supabase integration. `results.json` records ten
observations on a loopback Next dev server with all Supabase/provider variables
removed. Browser requests to other origins were blocked. No real account, email,
message or payment was created. Three public-page screenshots are retained.

Environment: Debian 13, Node 24.22.1, Playwright 1.65.1, system Chromium
156.0.8078.79. Viewports: 390×900 and 1440×900. Date: 2026-11-15 (Asia/Baghdad).

Run against an independently started local, provider-free app only. Do not run
while type generation/build is writing the same `.next` output. Install Playwright
in a separate tooling directory; it is not an application dependency:

```sh
# Start Next with Supabase/provider variables unset and no local credential file:
npm run dev -- --hostname 127.0.0.1 --port 3210
# In another Terminal, point WASLA_PLAYWRIGHT_PATH at your local installed driver.
node verification/browser/public-smoke.mjs
```

Optional harness-only variable names: `WASLA_PLAYWRIGHT_PATH`,
`WASLA_CHROMIUM_PATH`, `WASLA_LOCAL_BROWSER_ORIGIN`. The base URL must be HTTP
loopback. Use fresh contexts, never an existing signed-in browser. The harness
validates empty/malformed fields and submits a synthetic password only to prove
missing-configuration failure. No signup or recovery email request is submitted.

The initial harness needed visible-route form scoping because Next caches hidden
route DOM, and its route announcer also uses an alert role. Those selector failures
were fixed without weakening the application assertions. The final run passed.

Generated screenshots/results go under ignored `work/mvp-browser/`. The checked-in
results are explicitly public UI evidence; actual Auth/JWT/SSR and tenant browser
flows remain NOT TESTED. Running this checker cannot establish staging readiness.
