import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Writable } from 'node:stream'

test('custom requests go to main hobkin through the chat and preserve drafts; host palettes apply live, once', { skip: !process.env.HOBKIN_APPEARANCE_BROWSER }, async () => {
  const out = '/tmp/hobkin-pi-appearance-wiring'
  mkdirSync(out, { recursive: true })
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
    '--remote-debugging-pipe', '--user-data-dir=' + mkdtempSync(out + '/profile-'), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  let id = 0, buffer = '', session: string | undefined
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const blocked: string[] = []
  const send = (method: string, params = {}, sid = session): Promise<any> => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ;(chrome.stdio[3] as Writable).write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0')
  })
  chrome.stdio[4]!.on('data', data => {
    buffer += data
    let end: number
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (msg.id) {
        const request = pending.get(msg.id); pending.delete(msg.id)
        msg.error ? request?.reject(Error(JSON.stringify(msg.error))) : request?.resolve(msg.result)
      } else if (msg.method === 'Fetch.requestPaused') {
        const { requestId, request } = msg.params
        const safe = request.url.startsWith('http://localhost:5187/')
        if (!safe) blocked.push(request.url)
        void send(safe ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!safe ? { errorReason: 'BlockedByClient' } : {}) }, msg.sessionId)
      }
    }
  })
  const evaluate = async (expression: string) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const deadline = setTimeout(() => chrome.kill(), 14000)
  try {
    const target = await send('Target.createTarget', { url: 'about:blank' }, undefined)
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, undefined)).sessionId
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await send('Network.setBlockedURLs', { urls: ['*://*:5188/*', 'ws://*', 'wss://*'] })
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.WebSocket = class { static OPEN=1; static CLOSED=3; readyState=3; addEventListener(){} removeEventListener(){} close(){} send(){throw Error('network forbidden')} };` })
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: 'http://localhost:5187/' })
    await evaluate(`window.until = predicate => new Promise((resolve, reject) => {
      const end = performance.now() + 6000;
      function tick() { if (predicate()) resolve(true); else if (performance.now() > end) reject(Error('render deadline')); else requestAnimationFrame(tick) } tick();
    }); until(() => document.querySelector('#root')?.children.length)`)
    const checks = await evaluate(`(async () => {
      const loaded = path => performance.getEntriesByType('resource').map(x => x.name).filter(x => new URL(x).pathname === path).at(-1) ?? path;
      const { useChat } = await import(loaded('/src/features/chat/chat-store.ts'));
      const { useSettings } = await import(loaded('/src/features/settings/store.ts'));
      const { hostStore } = await import(loaded('/src/lib/host/client.ts'));
      const { setThemeChoice } = await import(loaded('/src/app/theme.ts'));
      const { DARK_PALETTE } = await import('/src/features/settings/rules.ts');
      document.documentElement.dataset.motion = 'still'; useSettings.getState().setMovement('still');
      const checks = []; const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name) };
      const calls = []; globalThis.__hobkinHost.connection.command = (name, args) => new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }));
      useChat.getState().change({ type: 'typed', text: 'My unfinished draft' });
      const original = useChat.getState().draft;
      hostStore.setState({ link: 'open', home: '/fake/browser-theme' });
      const sent = useSettings.getState().ask('Quiet forest', useChat, hostStore);
      check(useChat.getState().draft === original && calls[0].name === 'conversation.send' && calls[0].args.text === 'Build a theme: Quiet forest', 'request goes through the chat and preserves the draft');
      useChat.getState().change({ type: 'typed', text: 'Edited during acceptance' });
      calls.shift().resolve({ id: 'accepted', queued: false });
      check(await sent === true && useChat.getState().draft.text === 'Edited during acceptance', 'acceptance returns true without replacing later edits');
      const waiting = useSettings.getState().ask('Refused', useChat, hostStore);
      calls.shift().reject(Error('Refused'));
      check(await waiting === false && useChat.getState().draft.text === 'Edited during acceptance', 'refusal is not acceptance and preserves the draft');
      const appearance = { id: Date.now(), name: 'Forest', palette: DARK_PALETTE };
      hostStore.setState({ appearance });
      check(document.documentElement.dataset.palette === 'custom', 'host publication applies canonical colors');
      check(document.documentElement.style.getPropertyValue('--hb-custom-bg') === DARK_PALETTE.background, 'validated palette reaches CSS');
      setThemeChoice('light'); await until(() => document.documentElement.classList.contains('light'));
      hostStore.setState({ appearance: { ...appearance } });
      check(!useSettings.getState().customTheme && document.documentElement.classList.contains('light'), 'reconnect does not override chosen Light');
      hostStore.setState({ appearance: { ...appearance, id: appearance.id + 1, palette: { ...DARK_PALETTE, text: '#111111' } } });
      check(useSettings.getState().appearanceId === appearance.id + 1 && useSettings.getState().customTheme && document.documentElement.style.getPropertyValue('--hb-custom-text') !== '#111111', 'a vivid host palette applies, its text nudged to read');
      hostStore.setState({ appearance: null }); setThemeChoice('custom');
      document.querySelectorAll('button').forEach(x => { if (x.textContent.trim() === 'Skip setup') x.click() });
      const { useView } = await import(loaded('/src/app/view-store.ts')); useView.getState().toggleSettings();
      await until(() => document.getElementById('custom-theme-request'));
      document.getElementById('custom-theme-request').scrollIntoView({ behavior: 'instant', block: 'center' });
      await until(() => !document.documentElement.dataset.themeReveal);
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      window.appearanceFixture = { calls, useChat, useSettings, hostStore, appearance, checks };
      return checks;
    })()`)
    assert.equal(checks.length, 7)
    writeFileSync(out + '/custom-request.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    const formChecks = await evaluate(`(async () => {
      const { calls, useChat, hostStore, checks } = appearanceFixture;
      const input = document.getElementById('custom-theme-request');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'A lighter forest');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await until(() => !input.form.querySelector('button[type=submit]').disabled);
      // The sample page has no host, so its reconnect attempts can mark the link down between steps.
      hostStore.setState({ link: 'open' }); input.form.requestSubmit(); await until(() => calls.length === 1);
      calls.shift().reject(Error('Not connected'));
      await until(() => input.form.textContent.includes('Not sent: Not connected'));
      if (input.value !== 'A lighter forest') throw Error('failed request cleared the field');
      hostStore.setState({ link: 'open' }); input.form.requestSubmit(); await until(() => calls.length === 1);
      useChat.getState().change({ type: 'typed', text: 'Still my own draft' });
      const call = calls.shift();
      if (call.name !== 'conversation.send' || call.args.text !== 'Build a theme: A lighter forest') throw Error('form request did not go through the chat');
      call.resolve({ id: 'request', queued: false });
      await until(() => input.value === '');
      if (useChat.getState().draft.text !== 'Still my own draft') throw Error('form send consumed draft');
      checks.push('form failure keeps the words; a sent request clears the field and preserves the draft');
      return checks;
    })()`)
    writeFileSync(out + '/accepted-request.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await evaluate(`(async () => {
      const { hostStore, appearance, useSettings } = appearanceFixture;
      const accent = '#00ff41';
      hostStore.setState({ appearance: { ...appearance, id: appearance.id + 2, name: 'Quiet forest', palette: { ...appearance.palette, accent } } });
      await until(() => document.documentElement.style.getPropertyValue('--hb-custom-accent') === accent && useSettings.getState().customTheme);
    })()`)
    writeFileSync(out + '/applied-theme.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    writeFileSync(out + '/result.json', JSON.stringify({ checks: formChecks, blocked }, null, 2))
  } finally {
    clearTimeout(deadline)
    chrome.kill()
  }
})
