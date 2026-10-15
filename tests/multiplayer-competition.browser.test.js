const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  chromium = null;
}

const projectRoot = path.resolve(__dirname, '..');
const browserExecutable = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  chromium && chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(projectRoot, relative);
    if (!file.startsWith(projectRoot)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, content) => {
      if (error) {
        response.writeHead(404).end('Not found');
        return;
      }
      const type = path.extname(file) === '.js'
        ? 'text/javascript'
        : path.extname(file) === '.css' ? 'text/css' : 'text/html';
      response.writeHead(200, { 'Content-Type': type }).end(content);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('complete multiplayer flow keeps prompts outside boards and preserves records on restart', {
  skip: chromium && browserExecutable ? false : 'Playwright or a Chromium browser is unavailable.',
  timeout: 60000,
}, async (context) => {
  const server = await startServer();
  const address = server.address();
  const browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
  });
  context.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto(`http://127.0.0.1:${address.port}`);

  await page.evaluate(() => {
    document.getElementById('modeButton').click();
    document.getElementById('newGame').click();
  });
  assert.equal(await page.locator('#competitionCountdown strong').textContent(), '3');
  await page.waitForFunction(() => document.querySelector('#message h2')?.textContent === '雙人對戰開始！');

  const layout = await page.evaluate(() => {
    const rail = document.querySelector('[data-competition-toast="P1"]');
    const board = document.getElementById('board2');
    const railRect = rail.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    return {
      railBeforeBoard: rail.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING,
      railBottom: railRect.bottom,
      boardTop: boardRect.top,
      pointerEvents: getComputedStyle(rail).pointerEvents,
    };
  });
  assert.ok(layout.railBeforeBoard);
  assert.ok(layout.railBottom <= layout.boardTop);
  assert.equal(layout.pointerEvents, 'none');

  await page.setViewportSize({ width: 620, height: 900 });
  const mobileLayout = await page.evaluate(() => {
    const rail = document.querySelector('[data-competition-toast="P1"]').getBoundingClientRect();
    const board = document.getElementById('board2').getBoundingClientRect();
    return { railBottom: rail.bottom, boardTop: board.top };
  });
  assert.ok(mobileLayout.railBottom <= mobileLayout.boardTop);
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (let column = 0; column < 10; column += 1) {
    await page.keyboard.press('ArrowUp');
    const distance = column - 3;
    const direction = distance < 0 ? 'ArrowLeft' : 'ArrowRight';
    for (let step = 0; step < Math.abs(distance); step += 1) {
      await page.keyboard.press(direction);
    }
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => Number(document.getElementById('p2Sent')?.textContent) >= 4);
  await page.waitForFunction(() => document.getElementById('p1Pending')?.textContent === '4');
  await page.waitForFunction(() => document.querySelector('[data-competition-toast="P1"]')?.textContent === '即將送出 +4');
  await page.waitForFunction(() => document.querySelector('[data-competition-toast="P2"]')?.textContent === '即將收到 +4');

  await page.keyboard.press('w');
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => document.getElementById('p1Pending')?.textContent === '0');
  await page.waitForFunction(() => document.querySelector('[data-competition-toast="P2"]')?.textContent === '收到垃圾行');

  const keyboardWasBlocked = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown', bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(keyboardWasBlocked, true);
  assert.match(await page.locator('#inputStatus').textContent(), /已接收操作：down/);

  await page.locator('[data-action="left"]').click();
  assert.match(await page.locator('#inputStatus').textContent(), /已接收操作：left/);

  await page.evaluate(() => {
    document.getElementById('p2Sent').textContent = '6';
    document.getElementById('p2Combo').textContent = '2';
  });
  const p1Rail = page.locator('[data-competition-toast="P1"]');
  await p1Rail.filter({ hasText: '即將送出 +2' }).waitFor({ state: 'attached' });
  assert.match(await p1Rail.getAttribute('class'), /show/);
  await page.waitForFunction(() => document.querySelector('[data-competition-toast="P2"]')?.textContent === '即將收到 +2');
  await page.waitForFunction(() => document.querySelector('[data-competition-toast="P1"]')?.textContent === '2 COMBO!');

  await page.evaluate(() => {
    document.getElementById('p2Ko').textContent = '2';
    document.querySelector('#message h2').textContent = 'P1 獲勝！';
  });
  await page.waitForFunction(() => document.querySelector('[data-record="P1"]')?.textContent === '1 勝 / 0 敗');
  assert.match(await page.locator('#competitionSummary').innerText(), /P1 獲勝/);

  await page.locator('[data-action="left"]').click();
  assert.equal(await page.locator('#competitionCountdown strong').textContent(), '3');
  assert.equal(await page.locator('.competition-feedback-rail.show').count(), 0);
  assert.equal(await page.locator('.competition-global-alert.show').count(), 0);
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.competition-feedback-rail.show').count(), 0);
  assert.equal(await page.locator('.competition-global-alert.show').count(), 0);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('#message h2')?.textContent === '雙人對戰開始！');
  assert.equal(await page.locator('[data-record="P1"]').textContent(), '1 勝 / 0 敗');
  assert.match(await page.locator('#competitionSummary').getAttribute('class'), /hidden/);

  await page.locator('.competition-clear').click();
  assert.equal(await page.locator('[data-record="P1"]').textContent(), '0 勝 / 0 敗');
  assert.equal(await page.locator('[data-record="P2"]').textContent(), '0 勝 / 0 敗');
});
