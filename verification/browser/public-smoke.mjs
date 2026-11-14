// Public local UI only; no credentials, real Auth, SMTP or database integration.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.WASLA_LOCAL_BROWSER_ORIGIN ?? 'http://127.0.0.1:3210'
const url = new URL(base)
assert.ok(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'Local origin required')
const require = createRequire(import.meta.url)
// Install the browser driver outside the repo; never add provider secrets.
const driver = process.env.WASLA_PLAYWRIGHT_PATH ?? 'playwright'
const { chromium } = require(driver)
const directory = resolve('work/mvp-browser')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.WASLA_CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'], headless: true })
const checks = []
try {
 for (const width of [390, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { level: 1 }).waitFor()
  assert.equal(await page.locator('main:visible').getAttribute('dir'), 'rtl')
  assert.ok(await page.getByRole('link', { name: 'ابدأ الآن', exact: true }).count())
  assert.ok(await page.getByText('نسخة تطوير للمراجعة', { exact: false }).count())
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${directory}/home-${width}.png`, fullPage: true })
  checks.push(`PASS: Arabic homepage, links and no overflow at ${width}px`)
  await page.getByRole('link', { name: 'ابدأ الآن', exact: true }).click()
  await page.getByRole('heading', { name: 'إنشاء حساب أعمال' }).waitFor()
  assert.equal(await page.locator('input[name=email]:visible').getAttribute('dir'), 'ltr')
  await page.getByRole('button', { name: 'إنشاء الحساب', exact: true }).click()
  assert.equal(await page.locator('input[name=fullName]:visible').evaluate(e => e.validity.valueMissing), true)
  checks.push(`PASS: signup navigation and empty-form browser validation at ${width}px`)
  await page.goto(`${base}/login`)
  await page.getByRole('link', { name: /Forgot password/ }).click()
  await page.getByRole('heading', { name: 'استعادة حسابك' }).waitFor()
  await page.locator('input[name=email]:visible').fill('not-an-email')
  await page.getByRole('button', { name: 'إرسال رابط الاستعادة' }).click()
  assert.equal(await page.locator('input[name=email]:visible').evaluate(e => e.validity.typeMismatch), true)
  await page.getByRole('link', { name: 'English', exact: true }).click()
  await page.getByRole('heading', { name: 'Recover your account' }).waitFor()
  assert.equal(await page.locator('main:visible').getAttribute('dir'), 'ltr')
  await page.screenshot({ path: `${directory}/recovery-${width}.png`, fullPage: true })
  checks.push(`PASS: recovery discovery, email validation and English switch at ${width}px`)
  await page.goto(`${base}/reset-password?lang=en`)
  await page.locator('input[name=password]:visible').fill('synthetic-password-123')
  await page.locator('input[name=confirmPassword]:visible').fill('synthetic-password-123')
  await page.getByRole('button', { name: 'Update password', exact: true }).click()
  await page.locator('main:visible form [role=alert]').waitFor()
  assert.match(await page.locator('main:visible form [role=alert]').innerText(), /could not be confirmed|recovery email/)
  checks.push(`PASS: missing Auth configuration fails closed at ${width}px (not authenticated integration)`)
  await page.goto(`${base}/dashboard?workspace=00000000-0000-4000-8000-000000000001`)
  await page.waitForURL('**/login')
  checks.push(`PASS: unauthenticated dashboard redirects to login at ${width}px`)
  await context.close()
 }
 await writeFile(`${directory}/results.json`, JSON.stringify({ checks, scope: 'Local public UI and safe missing-configuration failures only; no real Auth/database', realAuth: 'NOT TESTED' }, null, 2)+'\n')
 console.log(checks.join('\n'))
} finally { await browser.close() }
