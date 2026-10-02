# Development guide

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.js` | Host plugin: model declarations, settings mutations, and patch startup |
| `client.js` | Browser contribution to `settings.models.provider-card` |
| `thinking-patch.js` | Idempotent patch for supported Models editor layouts |
| `patch-editor-thinking.mjs` | Optional manual entry point for the same patch |
| `cordis.patch.yml` | Cordis bundle registration |
| `test/` | Offline host, patch, and browser tests |

The browser module uses DSH's lazy-CJS loader protocol. The host module is ESM. There is no build pipeline or generated bundle to commit.

## Settings behavior

The host API operates on the `llm-pi-ai` settings namespace. Model lists are obtained from `llm.listModels(provider)`, so catalog-backed providers do not require an explicit `models` list to use the input-type card.

The following write targets describe the host API, not the native editor's save flow. Two provider shapes are supported:

| Provider configuration | Write target |
| --- | --- |
| Nonempty explicit `models` list | Matching model entry in that list |
| Catalog-backed provider | `modelOverrides[modelId]` |

For list-backed providers, settings mutations replace the whole array while preserving unrelated rows and fields. Index-addressed settings operations are not used because arrays are treated as leaves by the settings service.

For catalog overrides, removing the last declared field also removes an empty user-owned override. Overrides inherited from a settings composition base are overwritten with an empty entry when necessary, rather than exposing the inherited declaration again.

### Input modalities

The provider card reads the effective `inputModalities` supplied by the LLM runtime. Toggling image input writes an explicit `input` value:

```json
["text", "image"]
```

or:

```json
["text"]
```

It does not delete `input` when image input is disabled, because deletion would restore the provider or catalog default.

### Reasoning efforts

Selections produce an identity mapping of level names to wire values; `off` maps to `null`. Empty selections remove the explicit declaration. An `off`-only selection and unknown level names are rejected.

The editor patch writes through the native form callbacks, not through the plugin HTTP route:

- Legacy layout: `patch(index, { reasoningEfforts })`.
- Row layout: `props.onFieldChange("reasoningEfforts", value)`.

Changes are saved by the provider editor's normal save flow, which can create or update an explicit `models` list even for a previously catalog-backed provider. The injected callbacks do not select the host API's `modelOverrides` write path. The host route separately accepts reasoning declarations for callers that use its API.

## Host API

The plugin registers one exact route:

```text
GET  /dsh-model-modality/models
POST /dsh-model-modality/models
```

### Read

The response contains a settings `revision` and a list of providers. Each provider has a `provider` identifier, a `mode` (`list` or `catalog`), and model entries with `id`, optional `name`, `imageOn`, and `efforts`.

`efforts` reflects the configured declaration: `null` means absent/inherited; `false` and existing mappings are returned as configured.

### Write

Input-type declaration:

```json
{
  "provider": "example-provider",
  "modelId": "example-model",
  "revision": 3,
  "enable": true
}
```

Reasoning declaration:

```json
{
  "provider": "example-provider",
  "modelId": "example-model",
  "revision": 3,
  "levels": ["high", "max"]
}
```

`levels: []` or `levels: null` removes the declaration. Browser card writes include the revision from their last read; a conflicting revision produces `409`. The API also accepts writes without a numeric revision, so callers should include one for conflict protection.

Success returns `{ "ok": true }`. Invalid declarations return `400`; unavailable providers or models return `404`; unsupported methods return `405`.

### Request boundary

The current implementation requires a loopback `Host` (`localhost`, `127.0.0.0/8`, or `[::1]`), rejects `Sec-Fetch-Site: cross-site`, and checks a supplied `Origin` against the request's host and port. Refusals return `403`.

This is the plugin's request boundary, not a description of DSH's browser-login implementation. Reverse-proxy deployments and their access controls are outside the verified compatibility scope. Do not remove request checks to work around a proxy failure without a separate authorization design and tests.

## Editor patch

The host locates the Models UI through `clientModules.clientPath('@deepseek-ai/dsh-client-ui-settings-models')`. Patch selection is based on source anchors, not only on the DSH version string.

| Layout | Helper anchor | Update callback |
| --- | --- | --- |
| Legacy | `const { models, onChange, probe, operations, t, disabled } = props;` | `patch(index, { reasoningEfforts })` |
| Row | `function ModelRow(props) {` | `props.onFieldChange("reasoningEfforts", value)` |

The row-layout call is guarded by `props.inputField === "input"` so the shared DeepSeek editor is not modified.

Before writing, the patch checks its marker and required anchors, then creates `<target>.pre-thinking-patch`. On success, the host calls `clientModules.rebuilt()` so the registry serves the new bytes.

Patch results are `applied`, `present`, `unreadable`, `unwritable`, or `anchor-missing`. Unknown layouts and missing anchors do not write to the target. An I/O failure is reported and should be investigated using the matching bundle and backup.

### Manual patch command

```sh
node patch-editor-thinking.mjs /absolute/path/to/lib/client.js
```

The command **modifies the target bundle**; it is not a read-only inspection command. An explicit path is recommended when multiple installations exist. With no path, it searches common global-install locations. `DSH_MODALITY_TARGET` also supplies an explicit target and takes precedence over the positional path.

Disable the plugin before restoring an original bundle; otherwise it may be patched again on the next profile load. Restore only a backup from the same bundle version.

## Tests

```sh
npm test
node test/host.test.mjs
node test/patch.test.mjs
node test/client.test.mjs
```

- Host tests use mocked DSH services and cover reads, writes, revision forwarding, request refusals, and patch startup.
- Patch tests use synthetic legacy and row layouts, temporary files, idempotence checks, and drift checks.
- Browser tests use a mocked loader, React, slots, and fetch; they verify that the provider card contains input-type controls only.

Optional real-bundle checks discover common installation locations or use an explicit `DSH_MODALITY_REAL_DIR=/absolute/path/to/lib`. They read an installed bundle and patch a temporary copy; they do not modify the installation. Without a real bundle, synthetic tests still run.

## Distribution hygiene

`package.json.files` is an allowlist for the installable package. It includes the runtime modules, Cordis registration, user documentation, and license; npm includes `package.json` automatically. Tests and development documentation remain in the source repository but are not installed with the plugin.

Use `npm pack --dry-run --ignore-scripts` to inspect package contents. Do not include `.git`, local profiles, credentials, environment files, logs, vendor backups, or generated archives in a release artifact.

Screenshots are optional marketplace presentation assets, not runtime dependencies. This repository does not ship deployment screenshots or a screenshot manifest. Marketplace collection is maintained separately from the plugin runtime.

Before submitting changes, run the tests, check `git diff --check`, and inspect the package file list. Avoid unrelated profile, authentication, or deployment changes.
