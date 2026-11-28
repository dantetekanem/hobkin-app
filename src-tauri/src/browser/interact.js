// Evaluated in a private WKContentWorld. Arguments are serialized data, never executable source.
(action, expectedURL) => {
  if (location.href !== expectedURL) throw Error('The canvas page changed. Read it again.')
  const query = 'a[href],button,input,select,textarea,summary,label,[contenteditable=true],[draggable=true],[role],[tabindex]'
  const clean = value => (value || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const visible = el => el.getClientRects().length && (!el.checkVisibility || el.checkVisibility())
  const name = el => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent).join(' ').trim() || [...(el.labels || [])].map(label => label.innerText).join(' ') || el.placeholder || (el.matches('input:is([type=button],[type=submit])') ? el.value : '') || el.innerText || el.title)
  const role = el => el.getAttribute('role') || (el.localName === 'input' ? el.type : el.localName)
  const refs = globalThis.__hobkinCanvasRefs ??= { next: 1, byElement: new WeakMap(), byId: new Map() }
  function ref(el) {
    if (!refs.byElement.has(el)) refs.byElement.set(el, `e${refs.next++}`)
    const id = refs.byElement.get(el)
    refs.byId.set(id, el)
    return id
  }
  function all(root, selector) {
    const found = [...root.querySelectorAll(selector)]
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) found.push(...all(node.shadowRoot, selector))
    return found.filter(visible)
  }
  function target(on) {
    let matches
    if (/^@?e\d+$/.test(on)) {
      const el = refs.byId.get(on.replace(/^@/, ''))
      matches = el?.isConnected && visible(el) ? [el] : []
    } else if (on.startsWith('css:')) matches = all(document, on.slice(4).trim())
    else {
      matches = all(document, query).filter(el => name(el) === clean(on))
      // A label and the control it labels are one target, not two.
      matches = [...new Set(matches.map(el => el.control && visible(el.control) ? el.control : el))]
      if (matches.length > 1 && matches.every(el => el.matches('a[href]') && el.href === matches[0].href)) matches = matches.slice(0, 1)
    }
    if (matches.length !== 1) throw Error(matches.length ? 'Several controls match. Read and use a ref.' : 'No visible control matches. Read the page again.')
    if (matches[0].matches(':disabled,[aria-disabled=true]') || matches[0].closest('[inert]')) throw Error('That control is disabled.')
    return matches[0]
  }
  if (action.do === 'wait') {
    let found = false
    if (action.text) found = document.body.innerText.includes(action.text)
    if (action.on) { try { found = !!target(action.on) } catch { /* not present yet */ } }
    if (action.url) {
      const parts = action.url.split('**')
      let rest = location.href
      found = rest.startsWith(parts[0]) && rest.endsWith(parts.at(-1))
      for (const part of parts) { const at = rest.indexOf(part); if (at < 0) { found = false; break }; rest = rest.slice(at + part.length) }
    }
    return found ? 'found' : 'pending'
  }
  if (action.do === 'read') {
    const root = action.within ? document.querySelector(action.within) : document.body
    if (!root) throw Error('No such area on this page.')
    refs.readURL = location.href
    const page = location.origin + location.pathname
    const text = (action.what === 'text' || action.what === 'all') ? root.innerText.slice(0, 8000) : ''
    if (action.what === 'text') return `${page}\n${text}`
    refs.byId.clear()
    return [page, text, ...all(root, query).slice(0, 150).map(el => `${ref(el)} ${role(el)} ${JSON.stringify(name(el))}${el.type === 'file' ? ` (${el.files.length} selected)` : ''}`)].filter(Boolean).join('\n')
  }
  if (action.do === 'scroll') {
    if (!action.to) window.scrollBy(0, action.by ?? innerHeight * 0.8)
    else if (action.to === 'top' || action.to === 'bottom') window.scrollTo(0, action.to === 'top' ? 0 : document.scrollingElement.scrollHeight)
    else target(action.to).scrollIntoView({block:'center'})
    return 'Scrolled the canvas.'
  }
  if (refs.readURL !== location.href) throw Error('Read this canvas page before interacting with it.')
  if (action.do === 'press') return 'Ready for keyboard input.'
  const el = target(action.on)
  el.scrollIntoView({block:'nearest', inline:'nearest'})
  if (action.do === 'click' || action.do === 'hover' || action.do === 'upload') {
    if (action.do === 'upload' && !(el.control || el).matches('input[type=file]')) throw Error('Choose a file input, its visible label, or click the site’s upload button.')
    if (el.matches('a[href]') && !['https:', 'http:'].includes(el.protocol)) throw Error('Not a web link.')
    const box = el.getBoundingClientRect()
    const x = (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2
    const y = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2
    const hit = el.getRootNode().elementFromPoint(x, y)
    if (!(hit && (hit === el || el.contains(hit) || hit.control === el))) throw Error('The control is covered. Nothing was clicked.')
    return JSON.stringify([x / innerWidth, y / innerHeight])
  }
  if (action.do === 'select') {
    if (el.localName !== 'select') throw Error('Not a native select. Click the menu and its option instead.')
    const options = [...el.options].filter(o => o.value === action.option || o.label === action.option)
    if (options.length !== 1 || options[0].disabled || options[0].closest('optgroup:disabled')) throw Error('The option is unavailable or ambiguous.')
    el.selectedIndex = options[0].index
    for (const event of ['input','change']) el.dispatchEvent(new Event(event,{bubbles:true}))
    return 'Selected the option.'
  }
  if (action.do === 'fill' || action.do === 'type') {
    if (el.readOnly) throw Error('That field is read-only.')
    if (action.do === 'fill' && el.matches('input:is([type=date],[type=time],[type=month],[type=week],[type=datetime-local],[type=color],[type=range],[type=number])')) {
      const probe = el.cloneNode()
      probe.value = action.text
      if (probe.value !== action.text) throw Error('The field does not accept that value.')
      el.value = action.text
      for (const event of ['input', 'change']) el.dispatchEvent(new Event(event, {bubbles:true}))
      return 'Set the field value.'
    }
    if (!(el.isContentEditable || el.matches('textarea,input:not([type]),input:is([type=text],[type=email],[type=password],[type=search],[type=tel],[type=url],[type=number])'))) throw Error('Not an editable text field.')
    el.focus()
    if (action.do === 'fill') {
      if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(range) }
      else if (typeof el.select === 'function') el.select()
    }
    if (!document.execCommand(action.text ? 'insertText' : 'delete', false, action.text)) throw Error('WebKit refused the edit.')
    return action.do === 'fill' ? 'Replaced the field contents.' : 'Typed into the field.'
  }
  const center = element => { const r = element.getBoundingClientRect(); return {clientX:r.left + r.width/2, clientY:r.top + r.height/2} }
  function pointer(node, suffix, point, buttons) {
    const init = {...point, bubbles:true, cancelable:true, composed:true, buttons, pointerId:1, pointerType:'mouse', isPrimary:true}
    node.dispatchEvent(new PointerEvent('pointer'+suffix,init))
    node.dispatchEvent(new MouseEvent('mouse'+suffix,init))
  }
  if (action.do === 'drag') {
    const to = target(action.to), start = center(el), data = new DataTransfer()
    const drag = (node, type, point) => node.dispatchEvent(new DragEvent(type, {...point, dataTransfer:data, bubbles:true, cancelable:true, composed:true}))
    pointer(el, 'down', start, 1)
    drag(el, 'dragstart', start)
    to.scrollIntoView({block:'nearest'})
    const end = center(to)
    for (let i = 1; i <= 8; i++) {
      const point = {clientX:start.clientX+(end.clientX-start.clientX)*i/8,clientY:start.clientY+(end.clientY-start.clientY)*i/8}
      pointer(document.elementFromPoint(point.clientX,point.clientY) || to, 'move', point, 1)
    }
    drag(to, 'dragenter', end); drag(to, 'dragover', end); drag(to, 'drop', end)
    pointer(to, 'up', end, 0); drag(el, 'dragend', end)
    return 'Sent the drag and drop. Read the page to verify the result.'
  }
  throw Error('Unsupported canvas action.')
}
