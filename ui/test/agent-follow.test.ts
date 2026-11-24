import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Writable } from 'node:stream'

// Mounted verification against the already-running sample UI, never the native/real host.
test('agent follow distinguishes reading from layout changes and opens at newest', { timeout: 25000, skip: !process.env.HOBKIN_FOLLOW_BROWSER }, async () => {
  const out = '/tmp/hobkin-pi-transcript-follow'
  mkdirSync(out, { recursive: true })
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
    '--remote-debugging-pipe', '--user-data-dir=' + mkdtempSync(out + '/profile-'), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  let seq = 0, buffer = '', session: string | undefined
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const blocked: string[] = []
  const send = (method: string, params = {}, sid = session): Promise<any> => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ;(chrome.stdio[3] as Writable).write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0')
  })
  chrome.stdio[4]!.on('data', data => {
    buffer += data
    let end: number
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (message.id) {
        const request = pending.get(message.id); pending.delete(message.id)
        message.error ? request?.reject(Error(JSON.stringify(message.error))) : request?.resolve(message.result)
      } else if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params
        const safe = request.url.startsWith('http://localhost:5187/')
        if (!safe) blocked.push(request.url)
        void send(safe ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!safe ? { errorReason: 'BlockedByClient' } : {}) }, message.sessionId)
      }
    }
  })
  const evaluate = async (expression: string) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const deadline = setTimeout(() => chrome.kill(), 23000)
  try {
    const target = await send('Target.createTarget', { url: 'about:blank' }, undefined)
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, undefined)).sessionId
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
    await send('Network.setBlockedURLs', { urls: ['*://*:5188/*', 'ws://*', 'wss://*'] })
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.WebSocket = class { static OPEN=1; static CLOSED=3; readyState=3; addEventListener(){} removeEventListener(){} close(){} send(){throw Error('network forbidden')} };` })
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: 'http://localhost:5187/' })
    await evaluate(`window.until = predicate => new Promise((resolve, reject) => {
      const end = performance.now() + 5000;
      function tick() { if (predicate()) resolve(true); else if (performance.now() > end) reject(Error('render deadline')); else requestAnimationFrame(tick) } tick();
    }); until(() => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip setup')?.click(); return document.querySelector('nav[aria-label="Screens"]') }).then(async () => { const start = performance.now(); await until(() => performance.now() - start > 1200) })`)
    const result = await evaluate(`(async () => {
      const loaded = name => performance.getEntriesByType('resource').map(x => x.name).find(x => new URL(x).pathname.endsWith('/' + name));
      const react = await import(loaded('react.js')); const React = react.default ?? react;
      const dom = await import(loaded('react-dom_client.js')); const { createRoot } = dom.default ?? dom;
      const { useFollow } = await import('/src/features/agent-activity/use-follow.ts');
      const host = document.createElement('div'); document.body.append(host);
      host.style = 'position:fixed;inset:0;z-index:99999;background:white;color:black';
      const root = createRoot(host); const checks = [];
      const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name) };
      const frames = async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame) };
      function Probe({ identity }) {
        const follow = useFollow(); window.follow = follow;
        return React.createElement('div', { ref: follow.scroller, onScroll: follow.onScroll, tabIndex: 0, style: { height: 240, width: 400, overflowY: 'auto' } },
          React.createElement('ol', { ref: follow.content }, Array.from({ length: 30 }, (_, i) => React.createElement('li', { key: i, style: { height: 70 } }, identity + ' step ' + i))));
      }
      root.render(React.createElement(Probe, { key: 'first', identity: 'first', still: true })); await frames();
      const end = () => follow.scroller.current.scrollHeight - follow.scroller.current.clientHeight;
      check(Math.abs(follow.scroller.current.scrollTop - end()) < 2, 'entry is newest');
      // A layout clamp/focus scroll is not evidence that the user chose to read above.
      follow.scroller.current.scrollTop -= 200; await frames();
      follow.content.current.lastChild.style.height = '140px'; await frames();
      check(follow.pinned && Math.abs(follow.scroller.current.scrollTop - end()) < 2, 'layout scroll retains newest ownership');
      follow.content.current.style.width = '800px'; follow.scroller.current.scrollLeft = 30;
      check(follow.scroller.current.scrollLeft > 0, 'sideways drift fixture can move');
      follow.jumpToLatest(); await frames();
      check(follow.scroller.current.scrollLeft === 0, 'newest clears sideways drift');
      follow.content.current.style.width = '';
      window.followProbe = { root, React, Probe, frames, checks, check, end };
      return checks;
    })()`)
    assert.ok(result.includes('layout scroll retains newest ownership'))
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 120, deltaX: 0, deltaY: -450 })
    const checks = await evaluate(`(async () => {
      const { frames, check, checks, root, React, Probe, end } = followProbe;
      await until(() => !follow.pinned); const top = follow.scroller.current.scrollTop;
      follow.content.current.lastChild.style.height = '280px'; await frames();
      check(!follow.pinned && follow.scroller.current.scrollTop === top, 'wheel reading holds through growth');
      follow.jumpToLatest(); await frames(); check(follow.pinned && Math.abs(follow.scroller.current.scrollTop - end()) < 2, 'Newest resumes following');
      root.render(React.createElement(Probe, { key: 'second', identity: 'second', still: false })); await frames();
      check(follow.pinned && Math.abs(follow.scroller.current.scrollTop - end()) < 2 && follow.y.get() === 0, 'switch opens newest without shrink replay');
      return checks;
    })()`)
    await evaluate('follow.scroller.current.focus()')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
    await evaluate(`(async () => {
      await until(() => !follow.pinned && follow.scroller.current.scrollTop < followProbe.end() - 50);
      const start = performance.now(); await until(() => performance.now() - start > 300);
      const top = follow.scroller.current.scrollTop; follow.content.current.lastChild.style.height = '280px'; await followProbe.frames();
      followProbe.check(!follow.pinned && follow.scroller.current.scrollTop === top, 'keyboard reading holds through growth');
    })()`)
    await evaluate(`followProbe.root.unmount(); document.querySelectorAll('body > div').forEach(x => { if (!x.id && !x.children.length) x.remove() });
      until(() => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip setup')?.click(); return document.querySelector('nav[aria-label="Screens"]') })`)
    await evaluate(`(async () => {
      const loaded = path => performance.getEntriesByType('resource').map(x => x.name).filter(x => new URL(x).pathname === path).at(-1) ?? path;
      const { useView } = await import(loaded('/src/app/view-store.ts')); window.sampleView = useView;
      const ready = performance.now(); await until(() => performance.now() - ready > 1200);
      window.realNow = Date.now; document.activeElement?.blur(); useView.getState().openAgentCanvas('a3');
      await until(() => document.querySelector('[data-agent-exchange]'));
      Date.now = () => realNow() + 120000;
      await until(() => document.querySelectorAll('[data-agent-exchange] [data-step]').length > 3);
      window.checkCanvas = async (name) => {
        await until(() => document.querySelector('[data-canvas-screen] ol'));
        const start = performance.now(); await until(() => performance.now() - start > 1000);
        const list = document.querySelector('[data-canvas-screen] ol'); if (!list) throw Error(name + ': canvas disappeared, screen=' + sampleView.getState().screen); const scroll = list.parentElement;
        const nearEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
        if (nearEnd > 3 || scroll.scrollLeft !== 0) throw Error(name + ': not newest, gap=' + nearEnd);
        const nested = [...list.querySelectorAll('*')].filter(x => ['auto','scroll'].includes(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight + 2);
        if (nested.length) throw Error(name + ': inner scroll boxes');
        const edge = list.getBoundingClientRect();
        const wide = [...list.children].filter(x => x.getBoundingClientRect().left < edge.left - 1 || x.getBoundingClientRect().right > edge.right + 1);
        if (wide.length) throw Error(name + ': clipped step width');
        followProbe.checks.push(name + ': newest, contained, no inner scroll');
      };
      await checkCanvas('agent transcript');
    })()`)
    writeFileSync(out + '/agent-transcript.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await evaluate(`(async () => {
      sampleView.getState().openAgentCanvas('a1'); await until(() => document.querySelector('[data-canvas-screen="agent:a1"] ol'));
      Date.now = () => realNow() + 240000; await checkCanvas('switched agent transcript');
      sampleView.getState().openScreen('mind'); await until(() => document.querySelector('[data-canvas-screen="mind"] ol'));
      Date.now = () => realNow() + 360000; await checkCanvas('mind transcript'); Date.now = realNow;
    })()`)
    writeFileSync(out + '/mind-transcript.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    const mounted = await evaluate('followProbe.checks')
    writeFileSync(out + '/mounted-result.json', JSON.stringify({ checks: mounted, blocked }, null, 2))
    assert.equal(mounted.length, checks.length + 4)
  } catch (error) {
    writeFileSync(out + '/failure.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    writeFileSync(out + '/failure.txt', await evaluate(`JSON.stringify({ text: document.body.innerText, pinned: window.follow?.pinned, top: window.follow?.scroller.current?.scrollTop, active: document.activeElement?.outerHTML })`))
    throw error
  } finally {
    clearTimeout(deadline)
    chrome.kill()
  }
})
