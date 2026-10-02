# dsh-model-modality

Two per-model declarations DSH's shipped Models UI does not surface:

1. **输入类型** (text / image) checkboxes under every provider card on
   **设置 → 模型**.
2. A **思考等级** field inside the provider **编辑** dialog, on each model row's
   expanded area next to 上下文窗口 / 最大输出 token.

DSH's shipped Models page tells you which models a provider serves, but not what each
model *accepts* or which reasoning levels it offers. This plugin adds both, writing the
**official pi-ai fields** `input` and `reasoningEfforts`.

## 输入类型 — one row per model

```
teamo-router
  输入类型
  deepseek-v4-flash-free                     文本 ☑  图片 ☐
  deepseek-v4-pro                            文本 ☑  图片 ☐
  deepseek-v4-pro-free                       文本 ☑  图片 ☐
  gpt-5.6-luna                               文本 ☑  图片 ☐
  gpt-image-2                                文本 ☑  图片 ☐
```

`文本` is always on and always disabled — every model in these routes takes text. `图片`
is the one you toggle.

## 思考等级 — inside the 编辑 dialog

Click 编辑 on a provider, expand a model row, and the levels appear:

```
deepseek-v4-flash-free        [deepseek-v4-flash-free  ▾]  🗑
上下文窗口                    最大输出 token
[256K                     ]  [32K                      ]
思考等级
☐ 关  ☐ 最小  ☐ 低  ☐ 中  ☐ 高  ☐ 超高  ☑ Max
```

The checkbox set is the declaration: ticked levels are written to `reasoningEfforts` as an
identity map (`{ high: "high", max: "max" }`), with `关` written as `null`. **All
unchecked removes the key entirely** — meaning "inherit whatever the installed catalog
declares", which is the right default. An **off-only** pick is refused (the checkbox snaps
back), because the adapter invalidates an off-only declaration at profile load and writing
one would break the next boot.

This declaration is per model and per route: changing it for one model leaves every other
model in the same route alone.

## Why 思考等级 needs a patch, and how it stays automatic

DSH exposes exactly two extension points on the Models page
(`settings.models.provider-card` and `settings.models.footer`), and the 编辑 dialog
exposes **none**. A plugin can therefore *contribute* the 输入类型 card through the
official slot, but it cannot render a field inside the 编辑 dialog — the only way in is to
patch the shipped settings bundle.

This plugin does that itself, at profile load, through the module registry's own API:

- `ctx.clientModules.clientPath('@deepseek-ai/dsh-client-ui-settings-models')` locates the
  bundle on whatever machine it runs on — no hard-coded install path;
- the patch is anchored on upstream strings and **aborts without writing** if they moved,
  so a future DSH layout change degrades to "no field" rather than a broken bundle;
- the original is kept beside it as `client.js.pre-thinking-patch`;
- `ctx.clientModules.rebuilt()` re-hashes the bundle so the registry serves the patched
  bytes rather than its startup snapshot.

### Two supported layouts

The patch carries an anchor set per upstream layout and picks one by anchor presence
(the two sets are disjoint, so this is a reliable discriminator, not a guess):

| Layout | DSH | Anchor | Write path |
| --- | --- | --- | --- |
| `legacy` | ≤ 0.1.5 | `ModelListEditor` destructure + the `editCapacity(index, "maxTokens", …)` call | `patch(index, { reasoningEfforts })` |
| `row` | ≥ 0.2.0-rc.2 | `function ModelRow(props) {` + `onChange: props.onChange` | `props.onFieldChange("reasoningEfforts", value)` |

0.2.0-rc.2 split the model row into its own `ModelRow` component, which **two** editors
share: the pi-ai editor (`inputField: "input"`) and the DeepSeek editor
(`inputField: "inputModalities"`). `llm-deepseek` has no `reasoningEfforts` field at all, so
the injected call is guarded on `inputField === "input"` and renders nothing on the DeepSeek
route. That version also has no `patch(index, next)` reachable from the row, hence the
`onFieldChange` write path — whose `patch` deletes any key set to `undefined`, which is
exactly how "all unchecked = inherit" is expressed in both layouts.

Both layouts report a `layout` alongside the status, so a failure log names *which* anchor
drifted:

```
[dsh-model-modality] 思考等级 field patched into the provider edit dialog (row layout)
[dsh-model-modality] 思考等级 patch failed (anchor-missing, row layout): ModelRow onChange anchor not found — upstream layout changed; patch needs a re-read
```

If a future DSH matches neither anchor set, the status is `anchor-missing` with layout
`unknown` and **nothing is written** — the bundle keeps working, it just has no 思考等级
field.

The practical effect: **install once, and it survives `npm i -g @deepseek-ai/dsh`.** An
upgrade restores the pristine bundle, the marker disappears, and the next `dsh web` boot
patches it again. There is no script to re-run.

The same operation is available as a one-off CLI (useful for inspecting state without
restarting dsh, or for patching an install the plugin is not loaded in):

```bash
node patch-editor-thinking.mjs [path/to/lib/client.js]
DSH_MODALITY_TARGET=/path/to/lib/client.js node patch-editor-thinking.mjs
```

With no argument it auto-detects a global install (npm prefix, `%APPDATA%\npm`,
`/usr/local/lib/node_modules`, nvm, `~/.npm-global`). An explicit path is authoritative: if
you pass one that does not exist, the script says so instead of patching a different
install.

## Install

```bash
dsh plugin --profile web add github:hmtxj/dsh-model-modality
```

Then restart the profile (`dsh web`). The card appears on the next 设置 → 模型 render, and
the 思考等级 field on the next time you open a provider's 编辑 dialog.

Because the package declares `dsh.bundle.patch`, `dsh plugin add` also adds it to
`dsh.profile.bundles` automatically — no manual manifest editing.

<details>
<summary>Other install paths</summary>

From a local checkout (useful while developing):

```bash
git clone https://github.com/hmtxj/dsh-model-modality
dsh plugin --profile web add link:/absolute/path/to/dsh-model-modality
```

This plugin has **no build step and no `prepare` script** (it is hand-written
lazy-CJS/ESM), so `dsh plugin add` from git does not need an `allowBuilds` entry.

</details>

## What the 图片 checkbox writes

| 图片 checkbox | written to settings.yaml |
| --- | --- |
| ☑ | `input: [text, image]` |
| ☐ | `input: [text]` |

Unchecking writes an explicit `[text]` rather than deleting the key, because deleting it
would fall back to the route's `defaultInput` / the installed catalog and the checkbox
would bounce straight back on the next read.

## Where the declaration is written

DSH lets a route declare its models in two mutually exclusive ways, and the adapter
rejects a profile that mixes them. The plugin detects which one your route uses and
writes accordingly — the same two landing spots for both `input` and `reasoningEfforts`:

| Route shape | Written to | Effect |
| --- | --- | --- |
| has a `models:` list | that row's field (`input` / `reasoningEfforts`), whole-value rewrite | only this model changes |
| no `models:` list (catalog route) | `modelOverrides.<model-id>.<field>` | only this model changes; the other catalog models keep serving |

On a fresh machine where you only pasted an API key and never listed a single model, the
plugin still shows every model the route serves — it asks the llm runtime
(`llm.listModels`) rather than reading the settings tree, so catalog routes work with
zero configuration.

## Host route

The browser half talks to one loopback-only route registered by the host half:

```
GET  /dsh-model-modality/models
     -> { revision, providers: [{ provider, mode, models: [{ id, name?, imageOn, efforts }] }] }

POST /dsh-model-modality/models
     { provider, modelId, revision, enable: true | false }            # 图片 input
     { provider, modelId, revision, levels: [...] | null }            # 思考等级
     -> { ok: true } | 409 on a stale revision | 400/404 with { error }
```

The fence mirrors the host's own `/api`: loopback `Host` header, same-origin, and
`Sec-Fetch-Site: cross-site` refused. Writes carry the settings revision they were read
at and are refused with `409` if it moved, so two open settings pages cannot silently
clobber each other.

The route also accepts `{ provider, modelId, revision, levels: [...] | null }`, which
writes the sibling `reasoningEfforts` field with the same semantics:

| `levels` | written to settings.yaml |
| --- | --- |
| `["high", "max"]` | `reasoningEfforts: { high: high, max: max }` |
| `["off"]` | refused — `400`, "off-only declaration is invalid" |
| `[]` or `null` | the `reasoningEfforts` key is deleted (inherit the catalog) |

The 思考等级 field in the 编辑 dialog posts to this same route — it is the patch's only
job to *render* the checkboxes; the write path is the ordinary host route, identical to
the 图片 checkbox's.

## Requirements

- DSH `>= 0.1.5-rc.1` with the `web` profile (the card is a Web UI contribution).
- The `llm-pi-ai` adapter family (`@deepseek-ai/dsh-llm-pi-ai`) — i.e. any provider you
  configured through 设置 → 模型. Routes owned by another adapter family are untouched.
- For the 思考等级 field only: the shipped `@deepseek-ai/dsh-client-ui-settings-models`
  package, at a version whose anchors are still intact — either the `≤ 0.1.5` set or the
  `≥ 0.2.0-rc.2` set. If DSH moves them the plugin logs
  `patch failed (anchor-missing, <layout> layout)` and leaves the bundle untouched — the
  输入类型 card keeps working either way.

## Development

```bash
npm test          # all three halves, no DSH install needed
node test/host.test.mjs
node test/patch.test.mjs
node test/client.test.mjs
```

`test/host.test.mjs` drives the host half against mocked `settings` / `webServer` / `llm`
/ `clientModules` services: the GET shape, both route shapes, every write landing spot
(including the composition-base case), each refusal path, and the patch bootstrapping
(patched on load, backup written, `rebuilt()` called once, and *not* called when the
bundle was already patched).

`test/patch.test.mjs` drives `thinking-patch.js` against two synthetic bundles — one per
layout: the marker, both inserted functions, the helper landing inside the right function,
the call landing inside `modelAdvanced`'s children array, the pi-ai route guard, the
backup, idempotence, layout detection, and every failure mode (a drifted anchor reports its
layout and writes nothing). On a machine that has a real patched bundle it additionally
asserts the module reproduces it **byte for byte**; on one that has a pristine real bundle
it patches a copy and verifies the result. Point either check at another install with
`DSH_MODALITY_REAL_DIR=<...>/lib`; with neither, it prints
`no real bundle on this machine — synthetic checks only`.

`test/client.test.mjs` drives the browser half offline — it fakes the module loader,
`react`, the `slots` service and `fetch`, then renders the contributed card and asserts
on the checkboxes and the POST bodies. That is the only way to exercise the card without
a running `dsh web`.

The client half is a hand-written lazy-CJS bundle served over the profile's `/plugins`
route. Editing `client.js` while `dsh web` runs hot-reloads it within ~500ms — the
client module host stat-polls every bundle. Editing `index.js` (the host half) needs a
profile restart, because the ESM HMR watcher ignores `**/node_modules`, which is how the
profile links this package.

## License

MIT
