// Opens every Crewdeck screen in WebKit (the engine behind Safari on iPhone) at iPhone Duo sizes,
// as the owner, an admin and an employee. Saves screenshots and fails on layout problems.
// Run it through ./run.sh (it starts a throwaway server with demo data first).
import { webkit } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PW = 'demo-pass-123' // the demo people's test password (see seed.mjs)
const BASE = process.env.BASE || 'http://127.0.0.1:8097'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

// Apple doesn't publish the Duo's sizes in points; these are its App Store screenshot pixels ÷ 3.
const SIZES = [
  { id: 'duo-closed', label: 'iPhone Duo closed (outer screen)', width: 466, height: 678 },
  { id: 'duo-open', label: 'iPhone Duo open (inner screen)', width: 669, height: 951 },
  { id: 'iphone', label: 'Regular iPhone', width: 393, height: 852 },
  { id: 'narrow', label: 'Narrowest phone', width: 320, height: 640 },
]
const ONLY = process.env.SIZES ? process.env.SIZES.split(',') : null

const PAGES = {
  today: { hash: '#/today' },
  schedule: { hash: '#/schedule' },
  'schedule-day': { hash: '#/schedule', open: (p) => p.getByRole('columnheader').nth(5).click(), sheet: true },
  'add-shift': { hash: '#/schedule', open: (p) => p.getByRole('button', { name: 'Add shift' }).first().click(), sheet: true },
  requests: { hash: '#/requests' },
  timeoff: { hash: '#/timeoff' },
  hours: { hash: '#/hours' },
  account: { hash: '#/account' },
  settings: { hash: '#/settings' },
  team: { hash: '#/settings/team' },
  'team-person': { hash: '#/settings/team', open: (p) => p.getByText('Beto Ruiz', { exact: true }).first().click(), sheet: true },
  'team-self': { hash: '#/settings/team', open: (p) => p.getByText('Gina Garcia', { exact: true }).first().click(), sheet: true },
  access: { hash: '#/settings/access' },
  locations: { hash: '#/settings/locations' },
  positions: { hash: '#/settings/positions' },
  insights: { hash: '#/insights' },
  notifications: { hash: '#/notifications' },
}
const ROLES = [
  {
    id: 'owner',
    email: 'owner@demo.test',
    pages: ['today', 'schedule', 'schedule-day', 'add-shift', 'requests', 'timeoff', 'hours', 'settings', 'team', 'team-person', 'access', 'locations', 'positions', 'insights', 'notifications', 'account'],
  },
  { id: 'admin', email: 'gina@demo.test', pages: ['today', 'schedule', 'requests', 'team', 'team-self'] },
  { id: 'employee', email: 'beto@demo.test', pages: ['today', 'schedule', 'schedule-day', 'requests', 'timeoff', 'hours', 'account'] },
]

// Runs inside the page: what's wrong with the layout right now?
function audit() {
  const W = innerWidth
  const H = innerHeight
  const issues = []
  const notes = []
  const visible = (e) => {
    const s = getComputedStyle(e)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0
  }
  const sw = document.documentElement.scrollWidth
  if (sw > W + 1) issues.push(`the page scrolls sideways (${sw}px of content on a ${W}px screen)`)
  // Anything sticking out past the right edge that no box clips.
  const clippedByParent = (e) => {
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true
    return false
  }
  const out = [...document.body.querySelectorAll('*')].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1) && visible(e) && !clippedByParent(e)
  })
  if (out.length) issues.push(`${out.length} element(s) go past the screen edge, e.g. "${(out[0].textContent || out[0].tagName).trim().slice(0, 40)}"`)
  // Schedule: shift times, names and day headers must never be cut off.
  const cut = [...document.querySelectorAll('[data-time], [data-name], [role=columnheader] span')].filter((e) => e.scrollWidth > e.clientWidth + 0.5)
  if (cut.length) issues.push(`cut-off schedule text: ${[...new Set(cut.map((e) => e.textContent))].slice(0, 6).join(', ')}`)
  // Sheets must fit on the screen.
  const dlg = document.querySelector('[role=dialog]')
  if (dlg) {
    const r = dlg.getBoundingClientRect()
    if (r.left < -1 || r.right > W + 1) issues.push('the sheet is wider than the screen')
    if (r.top < -1) issues.push('the top of the sheet is off the screen')
    if (r.bottom > H + 1) issues.push('the bottom of the sheet is off the screen')
  }
  // Text cut with "…" (fine for long names, worth a look elsewhere).
  const dots = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && visible(e) && getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 0.5)
  if (dots.length) notes.push(`shortened with …: ${[...new Set(dots.map((e) => e.textContent.trim()))].slice(0, 5).join(' | ')}`)
  // Small tap targets (Apple asks for 44pt; under 28pt is hard to hit).
  const tiny = [...document.querySelectorAll('button, a[href], select, input:not([type=hidden])')].filter((e) => {
    const r = e.getBoundingClientRect()
    return visible(e) && r.width > 0 && r.height > 0 && (r.width < 28 || r.height < 28)
  })
  if (tiny.length) notes.push(`${tiny.length} small tap target(s), e.g. "${(tiny[0].getAttribute('aria-label') || tiny[0].textContent || '').trim().slice(0, 40)}"`)
  return { issues, notes }
}

async function signIn(page, email) {
  await page.goto(`${BASE}/#/today`)
  await page.getByPlaceholder('Email or phone number').fill(email)
  await page.getByPlaceholder('Password').fill(PW)
  await page.keyboard.press('Enter')
  await page.locator('nav a[href="#/schedule"]').waitFor({ timeout: 15000 })
}

async function settle(page) {
  await page.waitForTimeout(350)
  await page.locator('svg.animate-spin').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(250)
}

mkdirSync(OUT, { recursive: true })
const browser = await webkit.launch()
const results = []
for (const size of SIZES.filter((s) => !ONLY || ONLY.includes(s.id))) {
  for (const role of ROLES) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
      locale: 'en-US',
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|realtime/i.test(m.text()) && errors.push(m.text()))
    try {
      await signIn(page, role.email)
    } catch (e) {
      results.push({ size, role: role.id, page: 'sign-in', issues: [`could not sign in: ${e.message.split('\n')[0]}`], notes: [] })
      await ctx.close()
      continue
    }
    for (const id of role.pages) {
      const def = PAGES[id]
      errors.length = 0
      let issues = []
      let notes = []
      try {
        await page.keyboard.press('Escape').catch(() => {})
        await page.evaluate((h) => {
          location.hash = h === location.hash ? h + '?' : h
        }, def.hash)
        await settle(page)
        if (def.open) {
          await def.open(page)
          await page.locator('[role=dialog]').waitFor({ timeout: 5000 })
          await page.waitForTimeout(500) // sheet slide-in
        }
        ;({ issues, notes } = await page.evaluate(audit))
      } catch (e) {
        issues.push(`couldn't open it: ${e.message.split('\n')[0]}`)
      }
      if (errors.length) issues.push(`errors in the page: ${errors.slice(0, 2).join(' | ')}`)
      const file = `${size.id}/${role.id}-${id}.png`
      mkdirSync(join(OUT, size.id), { recursive: true })
      await page.screenshot({ path: join(OUT, file), fullPage: !def.sheet }).catch(() => {})
      results.push({ size, role: role.id, page: id, issues, notes, file })
      if (def.sheet) await page.keyboard.press('Escape').catch(() => {})
    }
    await ctx.close()
  }
}
await browser.close()

// Report: terminal summary + out/report.md + out/index.html (screenshots side by side).
const bad = results.filter((r) => r.issues.length)
const lines = [`# iPhone Duo check (WebKit)`, ``, `${results.length} screens checked, ${bad.length} with problems.`, ``]
for (const r of results) {
  const mark = r.issues.length ? '✗' : '✓'
  lines.push(`- ${mark} **${r.size.label}** · ${r.role} · ${r.page}${r.issues.length ? ': ' + r.issues.join('; ') : ''}${r.notes.length ? ` _(${r.notes.join('; ')})_` : ''}`)
}
writeFileSync(join(OUT, 'report.md'), lines.join('\n') + '\n')
const shown = SIZES.filter((s) => results.some((r) => r.size.id === s.id))
const keys = [...new Set(results.map((r) => `${r.role}-${r.page}`))]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPhone Duo check</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;background:#f2f2f7;margin:0;padding:16px}h2{margin:28px 0 8px}.row{display:flex;gap:16px;overflow-x:auto;align-items:flex-start}figure{margin:0;background:#fff;border-radius:12px;padding:8px}figcaption{font-weight:600;margin-bottom:6px}.bad{color:#c00}img{display:block;width:240px;border:1px solid #ddd;border-radius:6px}</style>
<h1>iPhone Duo check (WebKit)</h1><p>${results.length} screens checked, ${bad.length} with problems. Sizes: ${shown.map((s) => `${esc(s.label)} ${s.width}×${s.height}`).join(' · ')}</p>
${keys
  .map(
    (k) =>
      `<h2>${esc(k)}</h2><div class="row">${shown
        .map((s) => {
          const r = results.find((x) => x.size.id === s.id && `${x.role}-${x.page}` === k)
          if (!r) return ''
          return `<figure><figcaption class="${r.issues.length ? 'bad' : ''}">${esc(s.label)}${r.issues.length ? ' ✗' : ' ✓'}</figcaption>${r.file ? `<a href="${r.file}"><img src="${r.file}" loading="lazy"></a>` : ''}${r.issues.map((i) => `<p class="bad">${esc(i)}</p>`).join('')}</figure>`
        })
        .join('')}</div>`,
  )
  .join('')}`
writeFileSync(join(OUT, 'index.html'), html)

for (const r of bad) console.log(`✗ ${r.size.label} · ${r.role} · ${r.page}: ${r.issues.join('; ')}`)
console.log(`\n${results.length - bad.length} of ${results.length} screens look right. Screenshots: tools/duo-check/out/index.html`)
process.exit(bad.length ? 1 : 0)
