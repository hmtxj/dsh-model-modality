// Offline harness for the browser half of dsh-model-modality.
//
// The client bundle is a lazy-CJS module-loader payload, so it cannot be
// imported directly. This file fakes the three things it touches at load time
// (`window.__ModuleLoader__.load`, `require('react')`, a cordis-ish ctx with
// `slots`) and then drives the contributed Card against a stub `fetch`, so the
// rendering and write payloads are checked without a running dsh web.
//
// Run: node test/client.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// --- fake react ------------------------------------------------------------
// Elements are plain objects: { type, props, children }. Function components are
// invoked eagerly (they are all synchronous here), which is enough to walk the
// tree the Card builds. Hooks keep their state across passes like React does,
// and effects re-run only when their deps change — the Card's initial GET hangs
// off exactly that.
let hookStates = []
let hookCursor = 0
let effectSlots = []
let effectCursor = 0
let callbackSlots = []
let callbackCursor = 0

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  return left.every((value, at) => Object.is(value, right[at]))
}

const react = {
  createElement(type, props, ...children) {
    if (typeof type === 'function') return type({ ...(props ?? {}), children })
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
  },
  useState(initial) {
    const at = hookCursor++
    if (!(at in hookStates)) hookStates[at] = typeof initial === 'function' ? initial() : initial
    const set = (value) => {
      hookStates[at] = typeof value === 'function' ? value(hookStates[at]) : value
    }
    return [hookStates[at], set]
  },
  useEffect(fn, deps) {
    const at = effectCursor++
    const slot = effectSlots[at]
    if (slot && sameDeps(slot.deps, deps)) return
    if (slot && typeof slot.cleanup === 'function') slot.cleanup()
    effectSlots[at] = { deps, cleanup: fn() }
  },
  useCallback(fn, deps) {
    // Memoized on deps like React, so an effect depending on it does not
    // re-fire every pass (which would loop the GET forever).
    const at = callbackCursor++
    const slot = callbackSlots[at]
    if (slot && sameDeps(slot.deps, deps)) return slot.fn
    callbackSlots[at] = { deps, fn }
    return fn
  },
}

// --- fake module loader ----------------------------------------------------
let registered = null
const window = {
  __ModuleLoader__: {
    load(registration) {
      registered = registration
    },
  },
}

// --- fake fetch ------------------------------------------------------------
let routes = []
let posted = []

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

globalThis.fetch = async (url, options) => {
  if (options && options.method === 'POST') {
    posted.push(JSON.parse(options.body))
    const script = routes.shift()
    return jsonResponse(script.postStatus ?? 200, script.postBody ?? { ok: true })
  }
  const script = routes.shift()
  if (!script) throw new Error('client test: no scripted response left')
  if (script.getStatus && script.getStatus !== 200) return jsonResponse(script.getStatus, script.getBody ?? {})
  return jsonResponse(200, { revision: script.revision ?? 7, providers: script.providers ?? [] })
}

// --- load the bundle -------------------------------------------------------
globalThis.window = window
new Function('window', source)(window)
assert.ok(registered, 'client.js registered nothing with __ModuleLoader__')
assert.equal(registered.id, 'dsh-model-modality', 'registration id must equal the package name')

const plugin = registered.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`client test: unexpected require(${specifier})`)
})

// --- mount through a cordis-ish ctx ---------------------------------------
let registeredCard = null
const ctx = {
  inject(keys, callback) {
    // Mirrors the real scoped inject: run the closure where the services exist.
    callback({ slots: ctx.slots })
  },
  slots: {
    inject(key, generator) {
      const iterator = generator()
      let step = iterator.next()
      while (!step.done) {
        // The yielded value is `ctx.slots.register({...}, Card)`.
        step = iterator.next()
      }
    },
    register(declaration, component) {
      registeredCard = { declaration, component }
      return () => {}
    },
  },
}

plugin.apply(ctx)
assert.ok(registeredCard, 'the card was never registered into the slot')
assert.equal(registeredCard.declaration.name, 'settings.models.provider-card')
assert.equal(registeredCard.declaration.key, 'llm-pi-ai')

// --- helpers ---------------------------------------------------------------

/** Render one Card pass, flushing the pending fetch chain. */
async function render(props) {
  // A fresh mount, then one re-render once the load effect has settled — the
  // two passes share hook slots, exactly as React keeps them.
  hookStates = []
  effectSlots = []
  callbackSlots = []
  hookCursor = 0
  effectCursor = 0
  callbackCursor = 0
  registeredCard.component(props)
  // The load effect fires a fetch; let its promise chain settle, then render
  // again with the state it produced (what React would do on setSnap).
  await new Promise((resolve) => setTimeout(resolve, 0))
  return rerender(props)
}

/** Re-render the mounted component with the state the last pass left behind. */
function rerender(props) {
  hookCursor = 0
  effectCursor = 0
  callbackCursor = 0
  return registeredCard.component(props)
}

/** Flatten a rendered tree into {type, props} nodes. */
function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) walk(child, out)
  return out
}

function texts(node) {
  return walk(node)
    .flatMap((n) => (n.children ?? []).filter((c) => typeof c === 'string'))
    .join(' | ')
}

function checkboxes(node) {
  return walk(node).filter((n) => n.type === 'input' && n.props.type === 'checkbox')
}

/** One model's boxes, in render order: [text, image, off, minimal, low, medium, high, xhigh, max]. */
function rowBoxes(boxes, at) {
  return boxes.slice(at * 9, at * 9 + 9)
}

/** The seven level boxes of one model, in escalation order. */
function levelBoxes(boxes, at) {
  return rowBoxes(boxes, at).slice(2)
}

const MODEL = (id, imageOn, efforts) => ({ id, name: id, imageOn, efforts })

// --- 1. an unconfigured card renders nothing --------------------------------
{
  routes = [{ providers: [] }]
  const tree = await render({ provider: { provider: 'acme' }, configured: false, keyConfigured: false })
  assert.equal(tree, null, 'an unconfigured provider must contribute nothing')
  console.log('ok  unconfigured card renders nothing')
}

// --- 2. a list route renders one row per model with both controls -----------
{
  routes = [
    {
      revision: 11,
      providers: [
        {
          provider: 'acme',
          mode: 'list',
          models: [MODEL('one', false, null), MODEL('two', true, { off: null, high: 'high' })],
        },
      ],
    },
  ]
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  const boxes = checkboxes(tree)
  // 2 models x (1 disabled text + 1 image + 7 levels) = 18
  assert.equal(boxes.length, 18, `expected 18 checkboxes, got ${boxes.length}`)
  const first = rowBoxes(boxes, 0)
  const second = rowBoxes(boxes, 1)
  assert.equal(first[0].props.disabled, true, 'the text box is always disabled')
  assert.equal(first[0].props.checked, true, 'the text box is always checked')
  assert.equal(first[1].props.checked, false, 'model one does not accept images')
  assert.equal(second[1].props.checked, true, 'model two accepts images')
  // model one declares nothing: every level box is clear
  assert.deepEqual(
    levelBoxes(boxes, 0).map((b) => b.props.checked),
    [false, false, false, false, false, false, false],
    'an undeclared model shows no ticks',
  )
  // model two declares off+high: exactly 关 and 高 are lit
  assert.deepEqual(
    levelBoxes(boxes, 1).map((b) => b.props.checked),
    [true, false, false, false, true, false, false],
    'off+high declaration must light exactly 关 and 高',
  )
  assert.match(texts(tree), /模型声明/)
  assert.match(texts(tree), /写在该渠道自己的模型清单里/)
  console.log('ok  list route renders 2 rows, both controls, correct ticks')
}

// --- 3. a catalog route says the declaration is per-model ------------------
{
  routes = [
    {
      revision: 3,
      providers: [{ provider: 'acme', mode: 'catalog', models: [MODEL('solo', false, null)] }],
    },
  ]
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  assert.match(texts(tree), /只改这一个模型，同渠道其他模型不受影响/)
  console.log('ok  catalog route explains the per-model scope')
}

// --- 4. an empty model list gets an actionable hint, not the old models hint -
{
  routes = [{ revision: 1, providers: [] }]
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  const shown = texts(tree)
  assert.match(shown, /先在设置里填好它的 API 密钥/)
  assert.doesNotMatch(shown, /settings\.yaml/, 'the stale "declare models in settings.yaml" hint must be gone')
  assert.equal(checkboxes(tree).length, 0, 'no rows without models')
  console.log('ok  empty route shows the API-key hint')
}

// --- 5. toggling image POSTs enable:true ------------------------------------
{
  routes = [
    { revision: 5, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, null)] }] },
    { revision: 6, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', true, null)] }] },
  ]
  posted = []
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  const image = rowBoxes(checkboxes(tree), 0)[1]
  image.props.onChange({ target: { checked: true } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted, [{ provider: 'acme', revision: 5, modelId: 'one', enable: true }])
  console.log('ok  image toggle POSTs { enable: true } with the read revision')
}

// --- 6. toggling a level POSTs the full picked set --------------------------
{
  routes = [
    { revision: 5, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, { high: 'high' })] }] },
    { revision: 6, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, { high: 'high', max: 'max' })] }] },
  ]
  posted = []
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  const levels = levelBoxes(checkboxes(tree), 0)
  assert.deepEqual(
    levels.map((b) => b.props.checked),
    [false, false, false, false, true, false, false],
    'only 高 is declared to start with',
  )
  levels[6].props.onChange({ target: { checked: true } }) // Max
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted, [{ provider: 'acme', revision: 5, modelId: 'one', levels: ['high', 'max'] }])
  console.log('ok  level toggle POSTs the whole escalation-ordered set')
}

// --- 7. unchecking the last level asks to inherit (levels: null) ------------
{
  routes = [
    { revision: 5, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, { high: 'high' })] }] },
    { revision: 6, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, null)] }] },
  ]
  posted = []
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  levelBoxes(checkboxes(tree), 0)[4].props.onChange({ target: { checked: false } }) // uncheck 高
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted, [{ provider: 'acme', revision: 5, modelId: 'one', levels: null }])
  console.log('ok  clearing the last level POSTs levels: null (inherit)')
}

// --- 8. an off-only pick is refused locally, with no request ----------------
{
  routes = [{ revision: 5, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, null)] }] }]
  posted = []
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  levelBoxes(checkboxes(tree), 0)[0].props.onChange({ target: { checked: true } }) // 关 alone
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted, [], 'an off-only pick must not reach the host')
  const after = rerender({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  assert.match(texts(after), /「关」不能单独声明/)
  console.log('ok  off-only pick refused locally with an explanation')
}

// --- 9. a 409 surfaces as a retry message ----------------------------------
{
  routes = [
    { revision: 5, providers: [{ provider: 'acme', mode: 'list', models: [MODEL('one', false, null)] }] },
    { postStatus: 409, postBody: { error: 'revision conflict' } },
  ]
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  rowBoxes(checkboxes(tree), 0)[1].props.onChange({ target: { checked: true } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const after = rerender({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  assert.match(texts(after), /内容已变化，请重试/)
  console.log('ok  409 renders as a retry prompt')
}

// --- 10. a failed GET surfaces as a read error ------------------------------
{
  routes = [{ getStatus: 500, getBody: { error: 'boom' } }]
  const tree = await render({ provider: { provider: 'acme' }, configured: true, keyConfigured: true })
  assert.match(texts(tree), /读取失败：boom/)
  console.log('ok  a failed read renders as an error line')
}

console.log('client half: all checks passed')
