# Meta Developer setup for Wasla AI

Prepared 15 November 2026 for commit `b09e46b` and the pre-staging verification follow-up. This is a preparation guide, **not authorization to register a number, expose an endpoint, send a message or deploy**. Menu labels and Meta eligibility requirements change. Direct documentation retrieval was unavailable in this execution environment; confirm the linked official pages and the Graph version in your own dashboard before activation. No exact current API version or approved app status is asserted.

## 1. Prepare separate development assets

1. At <https://developers.facebook.com/apps/> create/select a business-owned app supporting the WhatsApp use case. Add WhatsApp, associate the intended development Business Portfolio and record the App ID privately. Keep App Secret server-only. Use app roles/testers while in development; do not switch the commercial app live for this test.
2. In WhatsApp API Setup record **WABA ID**, **Phone Number ID**, display number and whether the asset is a Meta-generated test number or your own dedicated staging number. These IDs differ; never use the display number as Phone Number ID.
3. For Meta's generated test-number flow, add and verify only a consenting team-controlled recipient in the dashboard's recipient allowlist. Do not click Send or run the generated curl command yet. Temporary dashboard access tokens are short-lived and are **not** an Embedded Signup credential-provisioning flow.
4. For the complete Wasla onboarding acceptance test, use an eligible dedicated number controlled by the team and a test/development business permitted by Meta for Embedded Signup. Confirm existing WhatsApp registration/coexistence restrictions in Meta first. The current application implements standard Embedded Signup, not a coexistence migration.

**Important test-number distinction:** Wasla derives the Cloud mapping through verified Embedded Signup; it does not accept a browser-supplied token/phone mapping or import `META_TEST_PHONE_NUMBER_IDS`. A generated dashboard test number may not support that onboarding flow. If Meta will not onboard that asset, stop that test and use an eligible dedicated staging asset after approval; do not insert an unverified mapping or reuse the legacy test inbox as proof. An additional reviewed operator-provisioning flow would be needed to support generated test assets directly.

## 2. Permissions and Embedded Signup

1. Configure **Facebook Login for Business / Embedded Signup** for WhatsApp and record its configuration ID as `META_EMBEDDED_SIGNUP_CONFIG_ID`. Use the configuration's code-based flow; the application requests `response_type=code`, `override_default_response_type=true` and session information version 3. It waits for a trusted Facebook `WA_EMBEDDED_SIGNUP` FINISH event and the SDK authorization code, then submits both to the authenticated server.
2. Required WhatsApp token scopes checked by Wasla: **`whatsapp_business_management`** and **`whatsapp_business_messaging`**. Request the appropriate access level/app review for onboarding unrelated businesses. Complete Meta business verification, access verification/Tech Provider requirements and any additional `business_management` permission requirements shown for your chosen onboarding configuration. Wasla does not currently query a Business Portfolio API requiring that additional permission; do not assume these two checked scopes alone establish commercial eligibility.
3. Register the exact app domain and approved **HTTPS origin** for the future staging site. Configure the allowed JavaScript SDK domains and the valid OAuth redirect URIs required by your actual Meta configuration. Wasla uses the JS SDK popup, not an application `/auth/meta/callback` route; do not invent or configure that nonexistent route. Supabase `/auth/callback` is a different login integration.
4. Confirm the supported Graph API version in Meta and use it consistently as `META_GRAPH_API_VERSION` (including the `v` prefix). Do not copy fixture version `v23.0` as a current-version recommendation.
5. Supply a six-digit number-registration/two-step-verification PIN **only in the authorized Wasla connection flow**. This is not the SMS verification code or webhook verification token. Never paste it into an issue or commit it. The application does not persist the PIN. Losing the response to registration requires inspection/reconnect; success is never assumed.

## 3. Webhook configuration

The exact callback path is:

```
https://<APPROVED-STAGING-HOST>/api/webhooks/meta
```

Use a public HTTPS hostname you approve later; `localhost` cannot receive Meta callbacks. No tunnel or deployment is started by this work. The legacy `/api/webhooks/whatsapp` endpoint is for the existing test inbox and is **not** this Cloud callback.

- Set `META_WEBHOOK_VERIFY_TOKEN` to a fresh random secret that **you generate privately**, then enter the identical value into Meta's **Verify token** field. For example, generate 32 random bytes locally with your password manager or `openssl rand -hex 32`; do not post the output here or put it in a URL manually. Configure it only in the approved server environment and Meta dashboard. This token is user-chosen, not an access token, App Secret, registration PIN or worker secret.
- Configure the **WhatsApp Business Account** webhook object and subscribe to **`messages`**. Delivery/read/failure notifications arrive in that field; there is no separate `statuses` subscription required by this code.
- Challenge GET must contain exactly one each of `hub.mode=subscribe`, `hub.verify_token` and numeric `hub.challenge`. Correct token returns the challenge; mismatched/missing/duplicated parameters fail. Without configuration it returns 503.
- POST integrity uses `X-Hub-Signature-256: sha256=<HMAC>` over the original request bytes with **`META_APP_SECRET`**, not the verify token. No unsigned POST or worker endpoint is accepted. Preserve the body and header through ingress; redact verification-token query strings and do not log request payloads.
- After the separately authorized connection flow, Wasla calls `/{WABA_ID}/subscribed_apps` and `/{PHONE_NUMBER_ID}/register`, checks token/phone/WABA ownership, then activates the channel. Verify both application-level field subscription and WABA-level app subscription; one does not replace the other.
- A 200 response means mapped events were accepted durably or were already accepted. Unknown unrelated mappings are intentionally ignored. Mapping conflicts/saturation return 503; never paper over these with a forced 200.

## 4. Server configuration names

| Purpose | Names |
|---|---|
| Existing application/Supabase public config | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` |
| Privileged server-only database adapter | `SUPABASE_CLOUD_SECRET_KEY` |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN` |
| Encrypted tokens | `META_TOKEN_ENCRYPTION_KEYS`, `META_TOKEN_ACTIVE_KEY_ID` |
| Worker authentication | `CLOUD_WORKER_SECRET` |
| AI/voice | `OPENAI_API_KEY`, optional `OPENAI_TRANSCRIPTION_MODEL` |

The token keyring is a JSON object of key ID → base64-encoded 32-byte AES key; active ID selects the encryption key. Keep previous decryption keys until ciphertext rotation is verified. Store no real key values in reports. Worker secret is independently generated, at least 32 random characters; an approved scheduler sends **POST** `/api/cloud/worker` with `Authorization: Bearer <worker-secret>`. No GET cron alias or scheduler is installed.

These variables **cannot enable traffic by themselves**. Both source review gates remain false; Cloud plan features/quotas default off/zero and pilot allowlist empty. Request separate approval for new SQL, gate changes, pilot entitlements, external AI/STT processing, number registration and sends. Payments remain disabled regardless.

## 5. What to provide before authorized acceptance testing

Provide configuration through an approved private secret store, never chat: app/config IDs, verified development WABA and eligible number, app-role/tester access, approved callback hostname, supported API version, secrets/keyring, consenting recipient and approved provider budgets. Confirm app review status and Meta asset eligibility. Approve voice consent/retention and processing region. Then follow [staging and E2E procedure](staging-cloud-checklist.md). Neither this guide nor passing mocks supplies that approval.

Official references to check in your dashboard:

- <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>
- <https://developers.facebook.com/docs/whatsapp/embedded-signup/>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/>
- <https://developers.facebook.com/docs/graph-api/webhooks/getting-started>
- <https://developers.facebook.com/docs/permissions/>
