# dsh-model-modality

Per-model **输入类型** (text / image) checkboxes on the DeepSeek Harness **设置 → 模型**
page.

DSH's shipped Models page tells you which models a provider serves, but not what each
model *accepts*. This plugin adds one row per model under every provider card:

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
is the one you toggle, and it writes the **official pi-ai per-model field** `input`.
Nothing is invented and nothing is monkey-patched: the shipped UI simply never surfaces
that field, and the `settings.models.provider-card` slot exists precisely so an
out-of-tree plugin can add it.

## Why this is a plugin and not a patch

DSH exposes exactly two extension points on the Models page
(`settings.models.provider-card` and `settings.models.footer`).

This plugin contributes to the official slot, so **a dsh upgrade never breaks it and
there is nothing to re-apply.**

## Install

```bash
dsh plugin --profile web add github:hmtxj/dsh-model-modality
```

Then restart the profile (`dsh web`). The card appears on the next 设置 → 模型 render.

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
writes accordingly:

| Route shape | Written to | Effect |
| --- | --- | --- |
| has a `models:` list | that row's `input` field, whole-array rewrite | only this model changes |
| no `models:` list (catalog route) | `modelOverrides.<model-id>.input` | only this model changes; the other catalog models keep serving |

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
     { provider, modelId, revision, enable: true | false }            # image input
     -> { ok: true } | 409 on a stale revision | 400/404 with { error }
```

The fence mirrors the host's own `/api`: loopback `Host` header, same-origin, and
`Sec-Fetch-Site: cross-site` refused. Writes carry the settings revision they were read
at and are refused with `409` if it moved, so two open settings pages cannot silently
clobber each other.

The route also accepts `{ provider, modelId, revision, levels: [...] | null }`, which
writes the sibling `reasoningEfforts` field with the same semantics. The card does not
send it — see below.

## Requirements

- DSH `>= 0.1.5-rc.1` with the `web` profile (the card is a Web UI contribution).
- The `llm-pi-ai` adapter family (`@deepseek-ai/dsh-llm-pi-ai`) — i.e. any provider you
  configured through 设置 → 模型. Routes owned by another adapter family are untouched.

## Development

```bash
npm test          # both halves, no DSH install needed
node test/host.test.mjs
node test/client.test.mjs
```

`test/host.test.mjs` drives the host half against mocked `settings` / `webServer` / `llm`
services: the GET shape, both route shapes, every write landing spot (including the
composition-base case), and each refusal path.

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
