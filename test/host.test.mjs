// Offline smoke test for the host half.
//
// The host half only runs inside a live dsh host, so this drives it through
// mocks: a fake settings view, a fake llm runtime, and a fake webServer that
// hands back the registered handler. Run with `node test/host.test.mjs`.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const NS = 'llm-pi-ai'

// A synthetic stand-in for the shipped settings bundle: the host half patches
// it through ctx.clientModules.clientPath() at load, and the harness routes
// that call here so every case exercises the real code path.
const BUNDLE = `const { models, onChange, probe, operations, t, disabled } = props;
		const modelAdvanced = (index, model) => [(0, react_jsx_runtime.jsxs)("label", {
			children: [(0, react_jsx_runtime.jsx)("input", {
				onChange: (event) => {
					editCapacity(index, "maxTokens", event.target.value);
				}
			})]
		})];
`
const bundleDir = mkdtempSync(join(tmpdir(), 'dsh-modality-host-'))
const bundlePath = join(bundleDir, 'client.js')
writeFileSync(bundlePath, BUNDLE)
// A second, still-pristine copy: the first harness() call patches bundlePath,
// so cases that need an actual write point at this one instead.
const freshDir = mkdtempSync(join(tmpdir(), 'dsh-modality-host-fresh-'))
writeFileSync(join(freshDir, 'client.js'), BUNDLE)
process.on('exit', () => {
  rmSync(bundleDir, { recursive: true, force: true })
  rmSync(freshDir, { recursive: true, force: true })
})

// `clientPath: null` means "the graph does not carry this bundle"; an omitted
// clientPath means the default synthetic bundle. (Passing `undefined` would hit
// the destructuring default instead, which is how this case was silently testing
// the already-patched path.)
function harness({ value, user, served, clientPath = bundlePath, deferred = false }) {
  const calls = []
  let handler
  const rebuilt = []
  const resolved = clientPath === null ? undefined : clientPath
  // `deferred` models the real boot order: the registry composes its table from
  // Loader entries as each one gets a fiber, and the row owning the settings
  // bundle is declared after `modules`. So clientPath() returns undefined at
  // first and only answers once the graph "settles" — which is what
  // onGraphChanged announces.
  let path = deferred ? undefined : resolved
  const graphListeners = new Set()
  // The real registry's rebuilt() ends in notifyGraphChanged(), so a listener
  // that re-hashes from inside a graph-changed callback is re-entered. Model
  // that faithfully: an unguarded listener would loop here.
  const notify = () => {
    for (const listener of [...graphListeners]) listener()
  }
  const ctx = {
    inject: (deps, callback) => {
      if (deps[0] === 'clientModules') {
        callback({
          clientModules: {
            clientPath: (id) => (id === '@deepseek-ai/dsh-client-ui-settings-models' ? path : undefined),
            rebuilt: (id) => {
              rebuilt.push(id)
              notify()
            },
            onGraphChanged: (listener) => {
              graphListeners.add(listener)
              return () => graphListeners.delete(listener)
            },
          },
        })
        return
      }
      assert.deepEqual(deps, ['settings', 'webServer', 'llm'])
      callback({
        settings: {
          describe: () => [{ ns: NS, value, user, revision: 7 }],
          mutate: async (ns, ops, revision) => {
            calls.push({ ns, ops, revision })
          },
        },
        webServer: {
          register: (route) => {
            handler = route.handler
          },
        },
        llm: {
          listModels: async (provider) => {
            if (served[provider] === undefined) throw new Error(`no adapter registered for provider "${provider}"`)
            return served[provider]
          },
        },
      })
    },
  }
  apply(ctx)
  assert.ok(handler, 'apply() must register the route')
  const settle = () => {
    path = resolved
    notify()
  }
  return { handler, calls, rebuilt, settle, listeners: () => graphListeners.size }
}

function request(method, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {
      yield* payload
    },
  }
}

function response() {
  const captured = { status: undefined, body: undefined }
  return {
    captured,
    writeHead(status) {
      captured.status = status
      return { end() {} }
    },
    end(chunk) {
      if (chunk !== undefined) captured.body = JSON.parse(chunk)
    },
  }
}

async function call(handler, method, body) {
  const res = response()
  await handler(request(method, body), res)
  return res.captured
}

const MODEL = (id, input) => ({ provider: 'acme', id, name: id, inputModalities: input })

// --- GET: models come from the llm runtime, not from the settings tree ------
{
  const { handler } = harness({
    value: { providers: { acme: { apiKeyEnv: 'ACME_API_KEY' } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text', 'image']), MODEL('two', ['text'])] },
  })
  const { status, body } = await call(handler, 'GET')
  assert.equal(status, 200)
  assert.equal(body.revision, 7)
  assert.deepEqual(body.providers, [
    {
      provider: 'acme',
      mode: 'catalog',
      models: [
        { id: 'one', name: 'one', imageOn: true, efforts: null },
        { id: 'two', name: 'two', imageOn: false, efforts: null },
      ],
    },
  ])
}

// --- GET: an unconfigured route has no adapter and is skipped ---------------
{
  const { handler } = harness({
    value: { providers: { acme: {}, idle: {} } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
  })
  const { body } = await call(handler, 'GET')
  assert.deepEqual(body.providers.map((entry) => entry.provider), ['acme'])
}

// --- GET: declared efforts surface verbatim from either spelling ------------
{
  const { handler } = harness({
    value: {
      providers: {
        listed: { models: [{ id: 'one', reasoningEfforts: { high: 'high', max: 'max' } }] },
        catalog: { modelOverrides: { two: { reasoningEfforts: false } } },
      },
    },
    user: undefined,
    served: { listed: [MODEL('one', ['text'])], catalog: [MODEL('two', ['text', 'image'])] },
  })
  const { body } = await call(handler, 'GET')
  assert.deepEqual(body.providers, [
    { provider: 'listed', mode: 'list', models: [{ id: 'one', name: 'one', imageOn: false, efforts: { high: 'high', max: 'max' } }] },
    { provider: 'catalog', mode: 'catalog', models: [{ id: 'two', name: 'two', imageOn: true, efforts: false }] },
  ])
}

// --- POST on a route with a models list: rewrite that list ------------------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { models: [{ id: 'one', name: 'One' }, { id: 'two' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text']), MODEL('two', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'two', revision: 7, levels: ['max', 'off'] })
  assert.equal(status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].revision, 7)
  assert.deepEqual(calls[0].ops, [
    {
      op: 'set',
      path: ['providers', 'acme', 'models'],
      value: [
        { id: 'one', name: 'One' },
        { id: 'two', reasoningEfforts: { off: null, max: 'max' } },
      ],
    },
  ])
}

// --- POST on a catalog route: write modelOverrides, not a models list -------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { apiKeyEnv: 'ACME_API_KEY' } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, levels: ['high'] })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops, [
    { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'one'], value: { reasoningEfforts: { high: 'high' } } },
  ])
}

// --- POST: clearing an override's last field drops the whole dict -----------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { modelOverrides: { one: { reasoningEfforts: { high: 'high' } } } } } },
    user: { providers: { acme: { modelOverrides: { one: { reasoningEfforts: { high: 'high' } } } } } },
    served: { acme: [MODEL('one', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, levels: [] })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops, [{ op: 'unset', path: ['providers', 'acme', 'modelOverrides'] }])
}

// --- POST: clearing one of two overrides keeps the dict ---------------------
{
  const { handler, calls } = harness({
    value: {
      providers: {
        acme: { modelOverrides: { one: { reasoningEfforts: { high: 'high' } }, two: { input: ['text'] } } },
      },
    },
    user: {
      providers: {
        acme: { modelOverrides: { one: { reasoningEfforts: { high: 'high' } }, two: { input: ['text'] } } },
      },
    },
    served: { acme: [MODEL('one', ['text']), MODEL('two', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, levels: [] })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops, [{ op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'one'] }])
}

// --- POST: clearing one field keeps the override's other fields -------------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { modelOverrides: { one: { input: ['text'], reasoningEfforts: { high: 'high' } } } } } },
    user: { providers: { acme: { modelOverrides: { one: { input: ['text'], reasoningEfforts: { high: 'high' } } } } } },
    served: { acme: [MODEL('one', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, levels: [] })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops, [
    { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'one'], value: { input: ['text'] } },
  ])
}

// --- POST: an override inherited from the base is edited, never unset -------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { modelOverrides: { one: { reasoningEfforts: { high: 'high' } } } } } },
    user: { providers: { acme: {} } },
    served: { acme: [MODEL('one', ['text'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, levels: [] })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops, [
    { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'one'], value: {} },
  ])
}

// --- POST: image off is written explicitly, so it cannot bounce back --------
{
  const { handler, calls } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text', 'image'])] },
  })
  const { status } = await call(handler, 'POST', { provider: 'acme', modelId: 'one', revision: 7, enable: false })
  assert.equal(status, 200)
  assert.deepEqual(calls[0].ops[0].value, [{ id: 'one', input: ['text'] }])
}

// --- POST: refusals ---------------------------------------------------------
{
  const { handler } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
  })
  const offOnly = await call(handler, 'POST', { provider: 'acme', modelId: 'one', levels: ['off'] })
  assert.equal(offOnly.status, 400)
  assert.match(offOnly.body.error, /off-only/)

  const unknown = await call(handler, 'POST', { provider: 'acme', modelId: 'one', levels: ['nope'] })
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /unknown thinking levels/)

  const missing = await call(handler, 'POST', { provider: 'acme', modelId: 'ghost', levels: ['high'] })
  assert.equal(missing.status, 404)
  assert.match(missing.body.error, /model not found/)

  const unserved = await call(handler, 'POST', { provider: 'idle', modelId: 'one', levels: ['high'] })
  assert.equal(unserved.status, 404)
  assert.match(unserved.body.error, /route is not served/)

  const badProvider = await call(handler, 'POST', { provider: 'ACME', modelId: 'one', levels: ['high'] })
  assert.equal(badProvider.status, 400)

  const badMethod = await call(handler, 'DELETE')
  assert.equal(badMethod.status, 405)
}

// --- fence: a foreign origin is refused ------------------------------------
{
  const { handler } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
  })
  const res = response()
  await handler(
    { method: 'GET', headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' }, async *[Symbol.asyncIterator]() {} },
    res,
  )
  assert.equal(res.captured.status, 403)
}

// --- the 思考等级 patch is applied through clientModules at load ------------
{
  const patched = readFileSync(bundlePath, 'utf8')
  assert.ok(patched.includes('dsh-thinking-field-patch'), 'apply() must patch the settings bundle')
  assert.ok(patched.includes('function DshThinkingField('), 'the edit dialog field must be inserted')
  // The original is kept beside it, so a failed boot can always be reverted.
  assert.equal(readFileSync(`${bundlePath}.pre-thinking-patch`, 'utf8'), BUNDLE)
}

// --- the registry is told to re-hash, else it serves the stale snapshot -----
{
  const { rebuilt } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
    clientPath: join(freshDir, 'client.js'),
  })
  assert.deepEqual(rebuilt, ['@deepseek-ai/dsh-client-ui-settings-models'])
}

// --- a profile whose graph lacks the bundle still gets the route ------------
// A bundle that never shows up is indistinguishable from one that has not shown
// up *yet*, so the plugin waits. That costs one Set entry and nothing else.
{
  const { handler, rebuilt, listeners } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
    clientPath: null,
  })
  const { status } = await call(handler, 'GET')
  assert.equal(status, 200, 'a missing client bundle must not break the route')
  assert.deepEqual(rebuilt, [], 'nothing to re-hash when the bundle is absent')
  assert.equal(listeners(), 1, 'the plugin waits for the bundle instead of giving up')
}

// --- a late-arriving bundle is patched when the graph settles ---------------
// The real boot order: `modules` is declared before the row that owns the
// settings bundle, so clientPath() answers undefined on the first try.
{
  const late = mkdtempSync(join(tmpdir(), 'dsh-modality-host-late-'))
  writeFileSync(join(late, 'client.js'), BUNDLE)
  process.on('exit', () => rmSync(late, { recursive: true, force: true }))
  const { rebuilt, settle, listeners } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
    clientPath: join(late, 'client.js'),
    deferred: true,
  })
  assert.deepEqual(rebuilt, [], 'nothing to patch before the bundle is in the graph')
  assert.equal(listeners(), 1, 'the plugin must be waiting for the graph to change')
  settle()
  assert.equal(
    readFileSync(join(late, 'client.js'), 'utf8').includes('dsh-thinking-field-patch'),
    true,
    'the bundle must be patched once it appears in the graph',
  )
  assert.deepEqual(rebuilt, ['@deepseek-ai/dsh-client-ui-settings-models'])
  assert.equal(listeners(), 0, 'the listener must unsubscribe after it succeeds')
  settle()
  assert.deepEqual(rebuilt, ['@deepseek-ai/dsh-client-ui-settings-models'], 'no second patch once patched')
}

// --- an already-patched bundle is not re-hashed -----------------------------
{
  const { rebuilt } = harness({
    value: { providers: { acme: { models: [{ id: 'one' }] } } },
    user: undefined,
    served: { acme: [MODEL('one', ['text'])] },
  })
  assert.deepEqual(rebuilt, [], 'no write means no re-hash')
}

console.log('host half: all checks passed')
