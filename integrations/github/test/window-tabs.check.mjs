// Focused rendered check: node integrations/github/test/window-tabs.check.mjs (sample Vite UI already on 5187).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
const out = '/tmp/hobkin-github-tabs-review'
mkdirSync(out, { recursive: true })
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions', '--remote-debugging-pipe', '--user-data-dir=' + mkdtempSync(out + '/profile-'), 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
let seq = 0, buffer = '', session
const pending = new Map(), blocked = []
function send(method, params = {}, sid = session) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0')
  })
}
chrome.stdio[4].on('data', data => {
  buffer += data
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
    if (msg.id) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? p?.reject(Error(JSON.stringify(msg.error))) : p?.resolve(msg.result)
    } else if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params
      const safe = /^http:\/\/localhost:5187\//.test(request.url)
      if (!safe) blocked.push(request.url)
      void send(safe ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!safe ? { errorReason: 'BlockedByClient' } : {}) }, msg.sessionId)
    }
  }
})
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
try {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null)
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*://*:5188/*'] })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://localhost:5187/' })
  await evaluate(`window.until = predicate => new Promise((resolve, reject) => { const end = performance.now() + 10000; function tick() { if (predicate()) resolve(true); else if (performance.now() > end) reject(Error('bounded render wait expired')); else requestAnimationFrame(tick) } tick() }); until(() => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip setup')?.click(); return document.querySelector('nav[aria-label="Screens"]') })`)
  const result = await evaluate(`(async () => {
    const loaded = path => performance.getEntriesByType('resource').map(x => x.name).filter(x => new URL(x).pathname === path).at(-1) ?? path;
    const { useView } = await import(loaded('/src/app/view-store.ts'));
    const { sampleGitHub } = await import('/@fs' + ${JSON.stringify(process.cwd())} + '/shared/protocol/github.ts');
    const { openPullRequestReview } = await import('/@fs' + ${JSON.stringify(process.cwd())} + '/integrations/github/window/review.ts');
    const { openLink: openOnGitHub } = await import('/src/lib/open-link.ts');
    const sample = sampleGitHub(Date.now());
    const { hostStore } = await import(loaded('/src/lib/host/client.ts'));
    const { HostConnection } = await import(loaded('/src/lib/host/connection.ts'));
    const { useSettings } = await import(loaded('/src/features/settings/store.ts'));
    const commands = []; HostConnection.prototype.command = (name, args) => { commands.push({ name, args }); return Promise.reject(Error('isolated fake')) };
    const external = []; window.open = (...args) => { external.push(args); return null };
    const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name) }; const checks = [];
    useView.getState().openScreen('github');
    await until(() => document.querySelector('[data-canvas-screen="github"] [data-github-row]'));
    const root = () => document.querySelector('[data-canvas-screen="github"]');
    const tabs = () => [...root().querySelectorAll('[role="tab"]')];
    check(tabs().length === 2, 'two real tabs');
    const entered = performance.now(); await until(() => performance.now() - entered > 750);
    const press = (element, key) => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const rows = () => [...root().querySelectorAll('[data-github-row]')];
    check(rows().every(x => x.href.includes('/pull/')), 'initial tab contains only PRs');
    tabs()[0].focus(); press(tabs()[0], 'ArrowRight');
    await until(() => tabs()[1].getAttribute('aria-selected') === 'true');
    check(document.activeElement === tabs()[1], 'Right selects and focuses Issues');
    check(rows().length > 0 && rows().every(x => x.href.includes('/issues/')), 'Issues replaces PR rows');
    const issue = rows()[0], event = new MouseEvent('click', { bubbles: true, cancelable: true });
    issue.addEventListener('click', e => e.preventDefault(), { once: true });
    issue.dispatchEvent(event);
    check(useView.getState().screen === 'github', 'issue does not enter Review');
    let prevented = false; openOnGitHub({ preventDefault() { prevented = true } }, issue.href);
    check(!prevented, 'browser issue opener preserves native navigation');
    press(tabs()[1], 'Home'); await until(() => tabs()[0].getAttribute('aria-selected') === 'true');
    check(rows().every(x => x.href.includes('/pull/')), 'Home restores PRs');
    press(tabs()[0], 'End'); await until(() => tabs()[1].getAttribute('aria-selected') === 'true');
    press(tabs()[1], 'ArrowLeft'); await until(() => tabs()[0].getAttribute('aria-selected') === 'true');
    check(document.activeElement === tabs()[0], 'End and Left switch and focus the expected tab');
    const pull = rows()[0], url = new URL(pull.href), parts = url.pathname.split('/');
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });
      // Cancel only after React's handler, to prevent opening any browser tab.
      const cancel = e => e.preventDefault(); document.addEventListener('click', cancel, { once: true });
      pull.dispatchEvent(click); check(useView.getState().screen === 'github', modifier + ' keeps browser semantics');
    }
    pull.focus(); press(pull, 'ArrowDown'); check(document.activeElement !== pull, 'Down walks PR rows');
    pull.click(); await until(() => useView.getState().screen === 'review');
    check(useView.getState().openReview === 'pr:' + parts[1].toLowerCase() + '/' + parts[2].toLowerCase() + '/' + parts[4], 'PR row selects canonical real Review ID');
    useView.getState().closeReview(); check(useView.getState().screen === 'github', 'Review returns to GitHub');
    openPullRequestReview({ ...sample.pulls[0], url: 'https://github.com/Owner/Repo/pull/712' });
    check(useView.getState().openReview === 'pr:owner/repo/712', 'spotlight helper uses shared canonical parser');
    check(external.length === 0, 'PR entry invokes no external opener');
    useView.getState().closeReview();
    await until(() => root()?.querySelector('[role="tab"]'));
    const returned = performance.now(); await until(() => performance.now() - returned > 850);
    hostStore.setState({ home: '/tmp/isolated-github-fixture', github: { ...sample, sample: false, reviews: [], pulls: [], issues: [], more: { pulls: false, reviews: false, issues: false }, error: 'Injected refresh failure' } });
    await until(() => root().textContent.includes('Injected refresh failure') && rows().length === 0);
    check(root().textContent.includes('You have no open pull requests.'), 'empty PR group survives refresh error');
    tabs()[1].click(); await until(() => root().textContent.includes('No open issue is assigned'));
    check(rows().length === 0, 'empty Issues remains switchable');
    hostStore.setState({ github: { ...sample, sample: false, connection: 'signed-out' } });
    await until(() => root().querySelector('[aria-label="Connect GitHub"]'));
    check(rows().length === 0, 'signed-out state shows connection help without rows');
    hostStore.setState({ home: null, github: null });
    useSettings.getState().setMovement('still');
    await until(() => rows().length > 0); tabs()[0].click();
    await until(() => rows().some(x => x.href.includes('/pull/')));
    check(rows().every(x => x.href.includes('/pull/')), 'Still supports tab switching');
    const settled = performance.now(); await until(() => performance.now() - settled > 750);
    rows()[0].focus();
    window.githubCheck = { useView, expected: 'pr:' + new URL(rows()[0].href).pathname.slice(1).replace('/pull/', '/').toLowerCase() };
    check(commands.length === 0, 'sample PR entry and fixture tab switching invoke no host commands');
    return { checks, commands, passed: true };
  })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  assert.equal(await evaluate(`until(() => githubCheck.useView.getState().screen === 'review').then(() => githubCheck.useView.getState().openReview === githubCheck.expected)`), true)
  result.checks.push('native Enter opens the focused PR in its own Review')
  await evaluate(`githubCheck.useView.getState().closeReview(); until(() => document.querySelector('[role="tab"]')).then(async () => { const start = performance.now(); await until(() => performance.now() - start > 850) })`)
  writeFileSync(out + '/result.json', JSON.stringify(result, null, 2))
  writeFileSync(out + '/tabs-still.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await evaluate(`(async () => { const urls = performance.getEntriesByType('resource').map(x => x.name); const { useSettings } = await import(urls.filter(x => new URL(x).pathname === '/src/features/settings/store.ts').at(-1)); useSettings.getState().setMovement('system'); githubCheck.useView.getState().openScreen('reports'); let start = performance.now(); await until(() => performance.now() - start > 850); githubCheck.useView.getState().openScreen('github'); start = performance.now(); await until(() => performance.now() - start > 1500) })()`)
  writeFileSync(out + '/tabs.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await evaluate(`document.querySelector('#github-tab-issues').click(); (async () => { const start = performance.now(); await until(() => performance.now() - start > 1100) })()`)
  writeFileSync(out + '/issues.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  assert.equal(result.passed, true)
  console.log(JSON.stringify(result, null, 2))
} finally {
  writeFileSync(out + '/blocked.json', JSON.stringify(blocked, null, 2))
  await send('Browser.close', {}, null)
}
