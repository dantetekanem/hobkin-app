import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// Exercise the same interaction program embedded in the shell. Native input and the OS picker need a real Mac window.
const source = readFileSync(new URL('../../../src-tauri/src/browser/interact.js', import.meta.url), 'utf8')
function fixture() {
  const url = 'https://example.org/form'
  let focused: ReturnType<typeof field>
  const events: string[] = []
  function field(label: string, localName: string, type = '') {
    return {
      label, localName, type, files: [], innerText: label, isConnected: true, value: '', readOnly: false,
      getAttribute: (name: string) => name === 'aria-label' ? label : null,
      getClientRects: () => [1], getBoundingClientRect: () => ({left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20}),
      scrollIntoView() {}, closest: () => null, select() { this.value = '' }, focus() { focused = this },
      matches: (selector: string) => selector === 'input[type=file]' ? type === 'file' : selector.startsWith('textarea,') && type === 'text',
      dispatchEvent: (event: Event) => { events.push(`${label}:${event.type}`); return true },
      getRootNode() { return { elementFromPoint: () => this } }, options: [{ value: 'ready', label: 'Ready', index: 1, closest: () => null }], selectedIndex: 0,
    }
  }
  const title = field('Title','input','text'), files = field('Files','input','file'), select = field('Status','select')
  const card = field('Card','div'), done = field('Done','div')
  const controls = [title,files,select,card,done]
  const document = {
    querySelectorAll: () => controls, getElementById: () => null, elementFromPoint: () => done,
    execCommand: (_: string, _ui: boolean, text: string) => { focused.value += text; return true },
    body: { querySelectorAll: () => controls, innerText: 'Form' },
  }
  const act = runInNewContext(`(${source})`, { document, innerWidth:100, innerHeight:100, location: new URL(url), Event, DragEvent: Event, MouseEvent: Event, PointerEvent: Event, DataTransfer: class {} })
  return { run: (step: Record<string,unknown>) => act(step, url), title, select, events }
}

test('edit and select the controls in the last read document; only the file control can be hit for an upload', () => {
  const page = fixture()
  assert.throws(() => page.run({do:'fill', on:'Title', text:'x'}), /Read this canvas page/)
  assert.match(page.run({do:'read'}), /e1 text "Title"/)
  page.run({do:'fill',on:'e1',text:'Hello'})
  page.run({do:'type',on:'Title',text:' world'})
  assert.equal(page.title.value, 'Hello world')
  page.run({do:'select',on:'Status',option:'Ready'})
  assert.equal(page.select.selectedIndex, 1)
  assert.deepEqual(page.events, ['Status:input','Status:change'])
  assert.deepEqual(JSON.parse(page.run({do:'upload',on:'Files'})), [0.35,0.2])
  assert.throws(() => page.run({do:'upload',on:'Title'}), /file input/)
})

test('drag starts on the source, drops on the destination, and ends on the source', () => {
  const page = fixture()
  page.run({do:'read'})
  page.run({do:'drag',on:'Card',to:'Done'})
  assert.deepEqual(page.events.filter(event => /:drag|:drop/.test(event)), ['Card:dragstart','Done:dragenter','Done:dragover','Done:drop','Card:dragend'])
})
