// Browser half of the dsh-model-modality plugin.
//
// Contributes ONE extension area to the Models settings page through the
// official `settings.models.provider-card` slot (keyed by the adapter family's
// settings namespace, `llm-pi-ai`). Every provider card lists its configured
// models with a single per-model declaration:
//
//   输入类型   text (always on) + image
//
// It writes the OFFICIAL pi-ai per-model field `input` (see
// @deepseek-ai/dsh-llm-pi-ai/lib/types/catalog.d.ts, PiAiModelProfile). The
// shipped Models UI simply does not surface it, which is exactly what the
// provider-card slot exists for: a plugin distributed outside the DSH
// repository adds per-model configuration without editing the shipped UI, so
// nothing here has to be re-applied after a dsh upgrade.
//
// Per-model THINKING LEVELS are deliberately NOT in this list: the list-level
// display is not what this plugin is for. They belong in the native model
// editor dialog, which exposes no slot at all — that one is
// `patch-editor-thinking.mjs`, which edits the shipped settings bundle and so
// has to be re-applied after every dsh upgrade.
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
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '4px 0',
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

      // Lucide "image" glyph, stroke = currentColor; no emoji.
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
            h('rect', { key: 'a', width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }),
            h('circle', { key: 'b', cx: 9, cy: 9, r: 2 }),
            h('path', { key: 'c', d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }),
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

        // POST, then re-read so the checkbox always shows what the host
        // actually stored. On refusal the previous snapshot is restored (which
        // also snaps an optimistic checkbox back).
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
          h('div', { style: styles.heading }, h(DeclareIcon, null), h('span', null, '输入类型')),
          body,
        ]

        if (body === null) {
          var models = snap.entry.models
          var rows = models.map(function (model) {
            var id = model.id
            return h(
              'div',
              { key: id, style: styles.model },
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
            )
          })
          children.push(h('div', { role: 'group', 'aria-label': route + ' 的输入类型' }, rows))
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
