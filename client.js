// Browser half of the dsh-model-modality plugin.
//
// Contributes ONE extension area to the Models settings page through the
// official `settings.models.provider-card` slot (keyed by the adapter family's
// settings namespace, `llm-pi-ai`). Every provider card lists its configured
// models with two per-model declarations:
//
//   输入类型   text (always on) + image
//   思考等级   off / minimal / low / medium / high / xhigh / max
//
// Both write OFFICIAL pi-ai per-model fields — `input` and `reasoningEfforts`
// (see @deepseek-ai/dsh-llm-pi-ai/lib/types/catalog.d.ts, PiAiModelProfile).
// The shipped Models UI simply does not surface them, which is exactly what
// the provider-card slot exists for: a plugin distributed outside the DSH
// repository adds per-model configuration without editing the shipped UI, so
// nothing here has to be re-applied after a dsh upgrade.
//
// Reads and writes go to the plugin's own loopback-only host route (GET/POST
// /dsh-model-modality/models, same loopback + same-origin fence the host puts
// in front of its own /api).
//
// The browser half deliberately injects ONLY `slots`: declaring `remote` here
// parks the plugin fiber waiting on services a plain slot registrant never
// satisfies, which is how the first attempt failed silently.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports): no build step, no dsh
// client imports. The registration id MUST equal the package name — the
// client module system matches the served bundle row against it.
window.__ModuleLoader__.load({
  id: 'dsh-model-modality',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var SLOT = 'settings.models.provider-card'
    var KEY = 'llm-pi-ai'
    var ROUTE = '/dsh-model-modality/models'

    // Escalation order, matching the adapter's own THINKING_LEVELS. `off` maps
    // to a null wire value ("supported, send nothing"); every other level maps
    // to its own name. A level absent from the dict is simply not offered.
    var LEVELS = [
      ['off', '关'],
      ['minimal', '最小'],
      ['low', '低'],
      ['medium', '中'],
      ['high', '高'],
      ['xhigh', '超高'],
      ['max', 'Max'],
    ]

    // --- declaration readers (the shape the host route reports) -------------

    // `efforts` is null when the key is absent (inherit from the installed
    // catalog), false for an explicitly non-reasoning model, else the dict.
    function declaredLevels(model) {
      var declared = model && model.efforts
      return declared !== null && typeof declared === 'object' ? declared : {}
    }

    function levelChecked(model, level) {
      var wire = declaredLevels(model)[level]
      if (wire === null) return level === 'off'
      return typeof wire === 'string' && wire.length > 0
    }

    // The full selection after toggling ONE level, in escalation order.
    function pickedLevels(model, changed, on) {
      return LEVELS.map(function (pair) {
        return pair[0]
      }).filter(function (level) {
        return level === changed ? on : levelChecked(model, level)
      })
    }

    var styles = {
      host: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '6px 0 2px',
        margin: '0',
      },
      heading: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        lineHeight: '18px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-secondary)',
      },
      note: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      error: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-state-error-primary, #f66)',
      },
      model: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '4px 0',
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      },
      levelRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '4px 8px',
        flexWrap: 'wrap',
      },
      modelId: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      controls: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      },
      locked: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      toggleLabel: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      levelLabel: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
        flexShrink: 0,
      },
      levels: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: '4px 10px',
      },
      levelItem: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
      },
    }

    function mountCard(ctx) {
      var react
      try {
        react = require('react')
      } catch (error) {
        console.error('[dsh-model-modality] settings card skipped:', error)
        return
      }
      var h = react.createElement
      var useState = react.useState
      var useEffect = react.useEffect
      var useCallback = react.useCallback

      // Lucide "sliders-horizontal" glyph, stroke = currentColor; no emoji.
      function DeclareIcon() {
        return h(
          'svg',
          {
            width: 13,
            height: 13,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { flexShrink: 0 },
          },
          [
            h('line', { key: 'a', x1: 21, x2: 14, y1: 4, y2: 4 }),
            h('line', { key: 'b', x1: 10, x2: 3, y1: 4, y2: 4 }),
            h('line', { key: 'c', x1: 21, x2: 12, y1: 12, y2: 12 }),
            h('line', { key: 'd', x1: 8, x2: 3, y1: 12, y2: 12 }),
            h('line', { key: 'e', x1: 21, x2: 16, y1: 20, y2: 20 }),
            h('line', { key: 'f', x1: 12, x2: 3, y1: 20, y2: 20 }),
            h('line', { key: 'g', x1: 14, x2: 14, y1: 2, y2: 6 }),
            h('line', { key: 'i', x1: 8, x2: 8, y1: 10, y2: 14 }),
            h('line', { key: 'j', x1: 16, x2: 16, y1: 18, y2: 22 }),
          ],
        )
      }

      function Card(props) {
        var route = props.provider && props.provider.provider
        var state = useState(function () {
          return { status: 'loading', entry: null, failure: null, revision: undefined }
        })
        var snap = state[0]
        var setSnap = state[1]
        var busyState = useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]

        var load = useCallback(
          function () {
            var cancelled = false
            fetch(ROUTE)
              .then(function (response) {
                return response.json().then(function (body) {
                  return { ok: response.ok, body: body }
                })
              })
              .then(function (answer) {
                if (cancelled) return
                if (!answer.ok) {
                  setSnap({
                    status: 'error',
                    entry: null,
                    failure: (answer.body && answer.body.error) || 'HTTP ' + answer.status,
                    revision: undefined,
                  })
                  return
                }
                var entry = null
                var list = answer.body.providers || []
                for (var i = 0; i < list.length; i++) if (list[i].provider === route) entry = list[i]
                setSnap({ status: 'ready', entry: entry, failure: null, revision: answer.body.revision })
              })
              .catch(function (error) {
                if (!cancelled)
                  setSnap({
                    status: 'error',
                    entry: null,
                    failure: String(error && error.message ? error.message : error),
                    revision: undefined,
                  })
              })
            return function () {
              cancelled = true
            }
          },
          [route],
        )
        useEffect(
          function () {
            return load()
          },
          [load],
        )

        if (props.configured !== true) return null

        // One writer for both declarations: POST, then re-read so the controls
        // always show what the host actually stored. On refusal the previous
        // snapshot is restored (which also snaps an optimistic checkbox back).
        function write(payload) {
          if (busyState[0]) return
          setBusy(true)
          var body = { provider: route, revision: snap.revision }
          for (var key in payload) body[key] = payload[key]
          fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then(function (response) {
              return response.json().then(function (respBody) {
                return { ok: response.ok, status: response.status, body: respBody }
              })
            })
            .then(function (answer) {
              setBusy(false)
              if (!answer.ok) {
                var message = (answer.body && answer.body.error) || 'HTTP ' + answer.status
                setSnap({
                  status: 'ready',
                  entry: snap.entry,
                  failure: (answer.status === 409 ? '内容已变化，请重试：' : '保存失败：') + message,
                  revision: snap.revision,
                })
                return
              }
              load()
            })
            .catch(function (error) {
              setBusy(false)
              setSnap({
                status: 'ready',
                entry: snap.entry,
                failure: '保存失败：' + String(error && error.message ? error.message : error),
                revision: snap.revision,
              })
            })
        }

        function toggleImage(modelId, enable) {
          write({ modelId: modelId, enable: enable })
        }

        function toggleLevel(model, level, on) {
          if (busyState[0]) return
          var picked = pickedLevels(model, level, on)
          // An off-only declaration is refused by the adapter at profile load,
          // so writing one would break the next boot. Refuse it here instead,
          // with a fresh snapshot object so React resets the checkbox.
          if (picked.length === 1 && picked[0] === 'off') {
            setSnap({
              status: 'ready',
              entry: snap.entry,
              failure: '「关」不能单独声明：要么一个都不勾（跟随官方目录），要么至少再勾一个其他档位。',
              revision: snap.revision,
            })
            return
          }
          write({ modelId: model.id, levels: picked.length === 0 ? null : picked })
        }

        var body = null
        if (snap.status === 'loading') body = h('p', { style: styles.note }, '读取中…')
        else if (snap.status === 'error')
          body = h('p', { style: styles.error, role: 'alert' }, '读取失败：' + (snap.failure || ''))
        else {
          var listed = snap.entry && snap.entry.models
          if (!Array.isArray(listed) || listed.length === 0)
            body = h(
              'p',
              { style: styles.note },
              '这个渠道还没有可用的模型。先在设置里填好它的 API 密钥，模型才会出现。',
            )
        }

        var children = [
          h('div', { style: styles.heading }, h(DeclareIcon, null), h('span', null, '模型声明')),
          body,
        ]

        if (body === null) {
          var models = snap.entry.models
          var rows = models.map(function (model) {
            var id = model.id
            var levelLabel = '思考等级' + (model.efforts === false ? '（已声明为非推理）' : '')
            return h(
              'div',
              { key: id, style: styles.model },
              h(
                'div',
                { style: styles.head },
                h('span', { style: styles.modelId, title: id }, id),
                h(
                  'span',
                  { style: styles.controls },
                  h('span', { style: styles.locked, title: '文本始终支持' }, '文本'),
                  h('input', {
                    type: 'checkbox',
                    checked: true,
                    disabled: true,
                    'aria-label': id + ' 输入类型 文本（始终支持）',
                  }),
                  h('span', { style: styles.toggleLabel }, '图片'),
                  h('input', {
                    type: 'checkbox',
                    checked: model.imageOn === true,
                    disabled: busy,
                    onChange: function (event) {
                      toggleImage(id, event.target.checked)
                    },
                    'aria-label': id + ' 输入类型 图片',
                  }),
                ),
              ),
              h(
                'div',
                { style: styles.levelRow },
                h('span', { style: styles.levelLabel }, levelLabel),
                h(
                  'span',
                  { role: 'group', 'aria-label': id + ' 的思考等级', style: styles.levels },
                  LEVELS.map(function (pair) {
                    var level = pair[0]
                    return h(
                      'label',
                      {
                        key: level,
                        style: styles.levelItem,
                        title:
                          level === 'off'
                            ? 'off：仅勾「关」无效，需至少再勾一个其他档位'
                            : '声明该模型支持 ' + level,
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: levelChecked(model, level),
                        disabled: busy,
                        onChange: function (event) {
                          toggleLevel(model, level, event.target.checked)
                        },
                        'aria-label': id + ' 思考等级 ' + pair[1],
                      }),
                      h('span', null, pair[1]),
                    )
                  }),
                ),
              ),
            )
          })
          children.push(h('div', { role: 'group', 'aria-label': route + ' 的模型声明' }, rows))
          // Where the declaration lands differs by route shape, and saying so
          // is the difference between "a checkbox that sticks" and "a checkbox
          // that mysteriously fights the installed catalog".
          children.push(
            h(
              'p',
              { style: styles.note },
              snap.entry && snap.entry.mode === 'list'
                ? '思考等级一个都不勾 = 不声明，跟随官方目录。这些声明写在该渠道自己的模型清单里。'
                : '思考等级一个都不勾 = 不声明，跟随官方目录。这些声明只改这一个模型，同渠道其他模型不受影响。',
            ),
          )
        }

        // A ready snapshot carrying a failure is always a write that did not
        // land (409, a rejected declaration, a network error), so it has to be
        // shown whether or not rows rendered — `body` is non-null exactly when
        // they did, which is the common case.
        if (snap.status === 'ready' && snap.failure)
          children.push(h('p', { style: styles.error, role: 'alert' }, snap.failure))

        return h('div', { style: styles.host }, children)
      }

      ctx.slots.inject(SLOT, function* () {
        yield ctx.slots.register({ name: SLOT, key: KEY }, Card)
      })
    }

    function apply(ctx) {
      // slots rides a scoped inject: the closure runs only where the slots
      // service exists (same optional-dependency posture as the other client
      // plugins). This is the only inject this half declares — see the file
      // header for why.
      if (typeof ctx.inject !== 'function') return
      ctx.inject(['slots'], (scope) => {
        try {
          mountCard(scope)
        } catch (error) {
          console.error('[dsh-model-modality] settings card skipped:', error)
        }
      })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
