const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const babel = require('@babel/standalone');
const { referenceCalculate } = require('./reference-scoring.cjs');
const root = path.join(__dirname, '..');
let server, browser, base;
before(async () => {
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
  babel.transform(source, { presets: ['react', 'env'] });
  server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, requested === '/' ? 'index.html' : requested);
    if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function setup({ configured = true, mobile = false, sdkMissing = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  await context.exposeFunction('__referenceCalculate', referenceCalculate);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === `${base}/access-config.js`) return route.fulfill({ contentType: 'text/javascript', body: configured ?
      "window.ZSM_ACCESS_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'};" :
      "window.ZSM_ACCESS_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_secret_do_not_use'};" });
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/react@18/')) return route.fulfill({ path: path.join(root, 'node_modules/react/umd/react.production.min.js'), contentType: 'text/javascript' });
    if (url.includes('/react-dom@18/')) return route.fulfill({ path: path.join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'), contentType: 'text/javascript' });
    if (url.includes('@babel/standalone')) return route.fulfill({ path: path.join(root, 'node_modules/@babel/standalone/babel.min.js'), contentType: 'text/javascript' });
    if (url.includes('@supabase/supabase-js')) return sdkMissing ? route.abort() : route.fulfill({ path: path.join(__dirname, 'mock-supabase.js'), contentType: 'text/javascript' });
    if (url.includes('cdn.tailwindcss.com')) return route.fulfill({ body: 'window.tailwind={};', contentType: 'text/javascript' });
    if (url.includes('script.google.com')) return route.fulfill({ json: { cars: [], pets: [], ecus: [] } });
    if (route.request().resourceType() === 'image') return route.abort();
    return route.fulfill({ body: '', contentType: url.includes('fonts') || url.includes('phosphor') ? 'text/css' : 'text/javascript' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  return { context, page, errors };
}
async function login(page, email) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
}
async function ready(page) {
  await page.getByRole('heading', { name: 'HỆ THỐNG TÍNH ĐIỂM THEO GIÂY' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.zsm-scoring-notice'));
}
test('missing or secret configuration and a failed SDK never mount the calculator', async () => {
  for (const options of [{ configured: false }, { sdkMissing: true }]) {
    const { context, page, errors } = await setup(options);
    await page.getByRole('heading', { name: 'Chưa thể đăng nhập' }).waitFor();
    assert.equal(await page.locator('table').count(), 0); assert.deepEqual(errors, []);
    await context.close();
  }
});
test('mobile signup validates confirmation, then requests email confirmation', async () => {
  const { context, page, errors } = await setup({ mobile: true });
  await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'test-results/login-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await page.getByLabel('Tên hiển thị').fill('Người mới');
  await page.getByLabel('Email', { exact: true }).fill('new@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password');
  await page.getByLabel('Nhập lại mật khẩu').fill('not-matching');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await page.getByText('Hai mật khẩu chưa khớp.').waitFor();
  await page.getByLabel('Nhập lại mật khẩu').fill('test-password');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await page.getByText('Hãy kiểm tra email để xác nhận đăng ký.', { exact: false }).waitFor();
  assert.equal(await page.locator('table').count(), 0); assert.deepEqual(errors, []);
  await context.close();
});
test('pending users cannot mount the app; approval admits them; block revokes scoring', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'pending@example.test');
  await page.getByRole('heading', { name: 'Tài khoản đang chờ duyệt' }).waitFor();
  assert.equal(await page.locator('table').count(), 0);
  assert.equal(await page.evaluate(() => window.__mockRpcCalls.filter(item => item.name === 'zsm_calculate').length), 0);
  await page.evaluate(() => window.__setStatus('pending@example.test', 'approved'));
  await page.getByRole('button', { name: 'Kiểm tra lại' }).click();
  await ready(page);
  assert.equal(await page.getByRole('button', { name: 'Quản lý tài khoản', exact: true }).count(), 0);
  await page.evaluate(() => window.__setStatus('pending@example.test', 'blocked'));
  const time = page.locator('input[placeholder="X"]').first();
  await time.fill('10000'); await time.blur();
  await page.getByRole('heading', { name: 'Tài khoản đã bị khóa' }).waitFor();
  assert.equal(await page.locator('table').count(), 0); assert.deepEqual(errors, []);
  await context.close();
});
test('owner approves and blocks users in the admin dialog with keyboard focus restored', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'owner@example.test'); await ready(page);
  await page.getByRole('button', { name: 'Quản lý tài khoản', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'pending@example.test' });
  await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'pending@example.test: đã duyệt.' }).waitFor();
  await page.getByRole('button', { name: 'Đã duyệt', exact: true }).click();
  await row.getByRole('button', { name: 'Khóa', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'test-results/admin-desktop.png'), fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Khóa', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'pending@example.test: đã khóa.' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Quản lý tài khoản');
  assert.deepEqual(errors, []); await context.close();
});
test('account storage is isolated and a same-account livestream tab follows edits', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'owner@example.test'); await ready(page);
  await page.locator('thead input').first().fill('Owner Racer'); await page.locator('thead input').first().blur();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await login(page, 'member@example.test'); await ready(page);
  assert.equal(await page.locator('thead input').first().inputValue(), 'VDV 1');
  await page.locator('thead input').first().fill('Member Racer'); await page.locator('thead input').first().blur();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await login(page, 'owner@example.test'); await ready(page);
  assert.equal(await page.locator('thead input').first().inputValue(), 'Owner Racer');
  const stream = await context.newPage(); await stream.goto(`${base}/index.html?broadcast=true&tab=scoreboard`);
  await stream.locator('.zsm-account-bar').waitFor({ state: 'attached' });
  const input = page.locator('input[placeholder="X"]').first(); await input.fill('10000'); await input.blur();
  await stream.getByText('1:00.00', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await stream.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
  assert.deepEqual(errors, []); await context.close();
});
test('network failures fail closed and recovery can return to the app', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'member@example.test'); await ready(page);
  await page.evaluate(() => { window.__networkFail = true; window.dispatchEvent(new Event('online')); });
  await page.getByRole('heading', { name: 'Chưa xác minh được quyền truy cập' }).waitFor();
  assert.equal(await page.locator('table').count(), 0);
  await page.evaluate(() => { window.__networkFail = false; });
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click(); await ready(page);
  await page.evaluate(() => window.__emitAuth('PASSWORD_RECOVERY'));
  await page.getByRole('heading', { name: 'Đặt mật khẩu mới' }).waitFor();
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('new-test-password');
  await page.getByLabel('Nhập lại mật khẩu').fill('new-test-password');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click(); await ready(page);
  assert.deepEqual(errors, []); await context.close();
});
test('scoring errors disable Excel export and retry loads server results', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'member@example.test'); await ready(page);
  await page.evaluate(() => { window.__networkFail = true; });
  const time = page.locator('input[placeholder="X"]').first(); await time.fill('10000'); await time.blur();
  await page.getByRole('alert').filter({ hasText: 'Chưa lấy được điểm' }).waitFor();
  assert.equal(await page.locator('button[title="Xuất Excel"]').isDisabled(), true);
  await page.evaluate(() => { window.__networkFail = false; });
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click(); await ready(page);
  assert.equal(await page.locator('button[title="Xuất Excel"]').isDisabled(), false);
  assert.deepEqual(errors, []); await context.close();
});
test('owner can explicitly import old local data without deleting the originals', async () => {
  const { context, page, errors } = await setup();
  await page.evaluate(() => localStorage.setItem('zsm_players_v11_final', JSON.stringify(['Legacy 1', 'Legacy 2', 'Legacy 3', 'Legacy 4'])));
  await login(page, 'owner@example.test'); await ready(page);
  assert.equal(await page.locator('thead input').first().inputValue(), 'VDV 1');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Nhập dữ liệu cũ', exact: true }).click(); await ready(page);
  assert.equal(await page.locator('thead input').first().inputValue(), 'Legacy 1');
  assert.ok(await page.evaluate(() => localStorage.getItem('zsm_players_v11_final').includes('Legacy 1')));
  assert.deepEqual(errors, []); await context.close();
});
test('1v1 advances sets from server results and resets progression for a new BO format', async () => {
  const { context, page, errors } = await setup();
  await login(page, 'member@example.test'); await ready(page);
  const mode = page.locator('select').filter({ has: page.locator('option[value="1v1"]') });
  await mode.selectOption('1v1'); await ready(page);
  assert.equal(await page.locator('input[placeholder="X"]').count(), 14);
  for (let round = 0; round < 4; round++) {
    const inputs = page.locator('input[placeholder="X"]');
    await inputs.nth(round * 2).fill('10000'); await inputs.nth(round * 2).blur();
    await inputs.nth(round * 2 + 1).fill('10100'); await inputs.nth(round * 2 + 1).blur();
    await ready(page);
  }
  await page.getByText('SET 2', { exact: true }).waitFor();
  const setBO = page.locator('select').filter({ has: page.locator('option[value="9"]') });
  await setBO.selectOption('9'); await ready(page);
  await page.getByText('SET 1', { exact: true }).waitFor();
  assert.equal(await page.locator('input[placeholder="X"]').count(), 18);
  assert.deepEqual(errors, []); await context.close();
});
