// Offline smoke test for the host half.
//
// The host half only runs inside a live dsh host, so this drives it through
// mocks: a fake settings view, a fake llm runtime, and a fake webServer that
// hands back the registered handler. Run with `node test/host.test.mjs`.
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const NS = 'llm-pi-ai'

function harness({ value, user, served }) {
  const calls = []
  let handler
  const ctx = {
    inject: (deps, callback) => {
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
  return { handler, calls }
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

console.log('host half: all checks passed')
