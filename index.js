// Host half of the dsh-model-modality plugin.
//
// Exposes one loopback-only JSON route the browser card talks to:
//
//   GET  /dsh-model-modality/models
//        -> { revision, providers: [{ provider, mode, models: [{id, name?, imageOn, efforts}] }] }
//        Models come from `ctx.llm.listModels(provider)`, which is the llm
//        runtime's own view of what a route serves: catalog defaults plus the
//        route's `models` list or `modelOverrides`, i.e. what actually answers
//        a request. That is what makes this work on a machine where the user
//        only typed an API key and never listed a single model.
//        imageOn is the effective modality answer, so the checkbox shows what
//        the model accepts today. efforts mirrors the row's declaration
//        verbatim (null = absent = inherit, false = explicitly non-reasoning,
//        dict = level -> wire string, `off` -> null).
//
//   POST /dsh-model-modality/models   { provider, modelId, revision, ...target }
//        - { levels: ["high","max"] }  -> declare `reasoningEfforts` as an
//            identity level->wire map (`off` -> null); an empty array or null
//            removes the key (inherit). Rejects an off-only selection and
//            unknown levels: the adapter invalidates both at load.
//        - { enable: true|false }      -> declare `input` as ["text","image"]
//            or ["text"]. The negative answer is written explicitly rather
//            than deleted, because deleting it would inherit the catalog's or
//            the route's `defaultInput` answer and the checkbox would bounce
//            straight back.
//        -> { ok: true } | 409 on revision conflict
//
// Where a write lands depends on how the route is configured, because the
// adapter refuses the other spelling outright ("sets modelOverrides for
// \"x\" beside a models list; models already replaces the served catalog, so
// declare the fields on its entries"):
//
//   route has a `models` list -> rewrite that list, touching only the target
//                                row's field (whole-array replacement: see
//                                below)
//   route has no `models`     -> write `modelOverrides[modelId]`, the
//                                catalog-route spelling, which leaves the
//                                other catalog models serving untouched
//
// Index-addressed path ops are not usable for the list case: dsh-settings'
// applyPathOp treats arrays as leaves, so an index set rebuilds the array as
// an object and an index unset is a silent no-op.
//
// The route rides a scoped ctx.inject like modlens's webServer routes: it
// appears where the services exist and never blocks headless boot. The fence
// mirrors modlens's /modlens/config (same loopback + same-origin judgment the
// host puts in front of its own /api).
import { applyThinkingPatch, SETTINGS_MODELS_PACKAGE } from './thinking-patch.js'

export const name = 'dsh-model-modality'
export const inject = []

const NS = 'llm-pi-ai'
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** localhost, ::1, or anything in 127/8 — same fence shape as modlens. */
function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isTrustedRequest(req) {
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function at(node, keys) {
  let cursor = node
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = cursor[key]
  }
  return cursor
}

function arrayAt(node, provider) {
  const value = at(node, ['providers', provider, 'models'])
  return Array.isArray(value) ? value : undefined
}

function dictAt(node, provider) {
  const value = at(node, ['providers', provider, 'modelOverrides'])
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

// A route either replaces the served catalog with its own `models` list or
// leaves the catalog serving and corrects single entries through
// `modelOverrides`; the adapter rejects a profile that tries both. The user
// layer decides which one this route is, so a rewrite round-trips exactly what
// the user owns instead of materializing schema defaults into settings.yaml.
// The resolved layer is only the fallback for a route composed from the
// settings base.
function targetOf(view, provider) {
  const owned = arrayAt(view?.user, provider)
  if (owned !== undefined && owned.length > 0) return { mode: 'list', models: owned }
  const effective = arrayAt(view?.value, provider)
  if (effective !== undefined && effective.length > 0) return { mode: 'list', models: effective }
  const userOverrides = dictAt(view?.user, provider)
  return {
    mode: 'catalog',
    overrides: userOverrides ?? dictAt(view?.value, provider) ?? {},
    userOverrides,
  }
}

/** The declared `reasoningEfforts` for one model, or null when it inherits. */
function declaredEfforts(target, modelId) {
  if (target.mode === 'list') {
    const row = target.models.find((model) => model && model.id === modelId)
    return row?.reasoningEfforts === undefined ? null : row.reasoningEfforts
  }
  const override = target.overrides[modelId]
  return override?.reasoningEfforts === undefined ? null : override.reasoningEfforts
}

/** Copy one row, replacing (or dropping, when value is undefined) one field. */
function withField(row, field, value) {
  const next = {}
  for (const key of Object.keys(row ?? {})) if (key !== field) next[key] = row[key]
  if (value !== undefined) next[field] = value
  return next
}

/**
 * Validate a `levels` payload into the declared `reasoningEfforts` value, or
 * `undefined` to drop the key (inherit). Returns `{ error }` when refused.
 */
function levelDeclaration(levels) {
  if (levels === null || levels === undefined || (Array.isArray(levels) && levels.length === 0)) return { value: undefined }
  if (!Array.isArray(levels)) return { error: 'levels must be an array of level names or null' }
  const picked = [...new Set(levels)]
  const unknown = picked.filter((level) => !LEVELS.includes(level))
  if (unknown.length > 0) return { error: `unknown thinking levels: ${unknown.join(', ')}` }
  if (!picked.some((level) => level !== 'off')) {
    return { error: 'off-only declaration is invalid: check at least one thinking level, or none to inherit' }
  }
  const value = {}
  for (const level of LEVELS) {
    if (picked.includes(level)) value[level] = level === 'off' ? null : level
  }
  return { value }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function describeView(settings) {
  return settings.describe({ redactSecrets: true }).find((entry) => entry.ns === NS)
}

function registerRoute(scope) {
  const settings = scope.settings
  const webServer = scope.webServer
  const llm = scope.llm

  webServer.register({
    name: 'dsh-model-modality',
    kind: 'exact',
    path: '/dsh-model-modality/models',
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) return send(res, 403, { error: 'request refused: this route answers same-origin loopback only' })
      const view = describeView(settings)
      if (view === undefined) return send(res, 404, { error: `settings namespace not registered: ${NS}` })

      if (req.method === 'GET') {
        const all = view.value && typeof view.value === 'object' ? view.value.providers : undefined
        const routes = all && typeof all === 'object' ? Object.keys(all) : []
        const providers = []
        for (const provider of routes) {
          let served
          try {
            served = await llm.listModels(provider)
          } catch {
            // No adapter registered for this route (unconfigured, or another
            // namespace's route): nothing to declare here.
            continue
          }
          const target = targetOf(view, provider)
          const models = served
            .filter((model) => model && typeof model.id === 'string' && model.id !== '')
            .map((model) => ({
              id: model.id,
              name: typeof model.name === 'string' ? model.name : undefined,
              imageOn: Array.isArray(model.inputModalities) && model.inputModalities.includes('image'),
              efforts: declaredEfforts(target, model.id),
            }))
          if (models.length > 0) providers.push({ provider, mode: target.mode, models })
        }
        return send(res, 200, { revision: view.revision, providers })
      }

      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      let body = ''
      for await (const chunk of req) body += chunk
      let input
      try {
        input = JSON.parse(body)
      } catch {
        return send(res, 400, { error: 'invalid JSON body' })
      }
      const provider = input?.provider
      const modelId = input?.modelId
      const revision = input?.revision
      if (typeof provider !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(provider)) return send(res, 400, { error: 'invalid provider' })
      if (typeof modelId !== 'string' || modelId === '') return send(res, 400, { error: 'invalid modelId' })

      // Ask the llm runtime what this route serves rather than trusting the
      // settings tree: it is the same answer the GET renders, and it refuses a
      // write for a model the route would never dispatch to.
      let served
      try {
        served = await llm.listModels(provider)
      } catch (error) {
        return send(res, 404, { error: `route is not served: ${provider} (${error?.message ?? String(error)})` })
      }
      if (!served.some((model) => model && model.id === modelId)) return send(res, 404, { error: `model not found: ${modelId}` })

      // Which field this POST touches: `levels` -> reasoningEfforts, else the
      // legacy `enable` -> input. Each writer returns the field's next value,
      // or undefined to remove the key (inherit).
      let field
      let nextValue
      if (Object.prototype.hasOwnProperty.call(input, 'levels')) {
        field = 'reasoningEfforts'
        const declared = levelDeclaration(input.levels)
        if (declared.error !== undefined) return send(res, 400, { error: declared.error })
        nextValue = declared.value
      } else {
        field = 'input'
        nextValue = input?.enable === true ? ['text', 'image'] : ['text']
      }

      const target = targetOf(view, provider)
      const ops = []
      if (target.mode === 'list') {
        // Whole-array replacement; keep every field of every row, touch only
        // the target row's field (removing the key returns the row to
        // inheritance).
        const next = target.models.map((model) =>
          model && model.id === modelId ? withField(model, field, nextValue) : model,
        )
        ops.push({ op: 'set', path: ['providers', provider, 'models'], value: next })
      } else {
        const next = withField(target.overrides[modelId], field, nextValue)
        if (Object.keys(next).length > 0) {
          ops.push({ op: 'set', path: ['providers', provider, 'modelOverrides', modelId], value: next })
        } else if (target.userOverrides === undefined) {
          // The entry lives in the composition base, so a user-layer unset
          // would just uncover it again. Overwrite it with the emptied entry
          // instead: same meaning (nothing declared), and it round-trips.
          ops.push({ op: 'set', path: ['providers', provider, 'modelOverrides', modelId], value: {} })
        } else if (Object.keys(target.userOverrides).length === 1) {
          // Last override the user owns: drop the dict rather than leave an
          // empty object behind.
          ops.push({ op: 'unset', path: ['providers', provider, 'modelOverrides'] })
        } else {
          ops.push({ op: 'unset', path: ['providers', provider, 'modelOverrides', modelId] })
        }
      }
      try {
        await settings.mutate(NS, ops, typeof revision === 'number' ? revision : undefined)
        return send(res, 200, { ok: true })
      } catch (error) {
        const message = error?.message ?? String(error)
        return send(res, /revision|conflict/i.test(message) ? 409 : 500, { error: message })
      }
    },
  })
}

// The 思考等级 field lives in the provider EDIT dialog, which exposes no slot,
// so it can only be added by patching the shipped settings bundle. Doing it
// here (instead of asking the user to run a script) means it survives every
// `npm i -g @deepseek-ai/dsh`: an upgrade restores the pristine bundle, the
// marker disappears, and the next boot patches it again.
function patchEditorThinking(scope) {
  let target
  try {
    target = scope.clientModules.clientPath(SETTINGS_MODELS_PACKAGE)
  } catch (error) {
    console.error('[dsh-model-modality] 思考等级 patch skipped — cannot locate the settings bundle:', error?.message ?? error)
    return true
  }
  if (!target) return false
  const result = applyThinkingPatch(target)
  if (result.status === 'applied') {
    // The module registry snapshots every bundle into memory at startup and
    // serves /plugins from that snapshot, so the bytes just written to disk are
    // not what the browser would get. rebuilt() is the registry's own re-hash
    // hook (the one its HMR watch uses): it re-reads the file, bumps the
    // revision and recomposes the graph, which is what makes the patched bundle
    // the one that actually ships.
    try {
      scope.clientModules.rebuilt(SETTINGS_MODELS_PACKAGE)
    } catch (error) {
      console.error('[dsh-model-modality] 思考等级 patch applied but the bundle was not re-hashed:', error?.message ?? error)
      return true
    }
    console.log('[dsh-model-modality] 思考等级 field patched into the provider edit dialog')
  } else if (result.status === 'present') {
    console.log('[dsh-model-modality] 思考等级 field already present')
  } else {
    console.error(`[dsh-model-modality] 思考等级 patch failed (${result.status}): ${result.detail ?? ''}`)
  }
  return true
}

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['settings', 'webServer', 'llm'], (scope) => {
    try {
      registerRoute(scope)
    } catch (error) {
      console.error('[dsh-model-modality] route skipped:', error)
    }
  })
  // Separate inject: a profile without clientModules (no web UI) must still get
  // the route above rather than losing everything to one missing service.
  ctx.inject(['clientModules'], (scope) => {
    const registry = scope.clientModules
    const attempt = () => {
      try {
        return patchEditorThinking(scope) === true
      } catch (error) {
        console.error('[dsh-model-modality] 思考等级 patch skipped:', error)
        return true
      }
    }
    if (attempt()) return
    // The registry builds its table from Loader entries as they get a fiber, and
    // the row that owns the settings bundle is declared after `modules`, so the
    // bundle may simply not be in the graph yet at this point. Its graph-changed
    // event is a pull-model notification — re-read and try again until the
    // bundle shows up. Give up rather than listen forever if the service cannot
    // notify us.
    if (typeof registry.onGraphChanged !== 'function') {
      console.error(`[dsh-model-modality] 思考等级 patch skipped — ${SETTINGS_MODELS_PACKAGE} is not in the client module graph`)
      return
    }
    let unsubscribe
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      if (typeof unsubscribe === 'function') unsubscribe()
    }
    try {
      unsubscribe = registry.onGraphChanged(() => {
        try {
          if (attempt()) stop()
        } catch (error) {
          console.error('[dsh-model-modality] 思考等级 patch skipped:', error)
          stop()
        }
      })
    } catch (error) {
      console.error('[dsh-model-modality] 思考等级 patch listener failed:', error?.message ?? error)
      return
    }
    // The graph may have settled between the first attempt and the subscribe.
    if (attempt()) stop()
    if (typeof scope.effect === 'function') scope.effect(() => stop, 'dsh-model-modality: 思考等级 patch retry')
  })
}
