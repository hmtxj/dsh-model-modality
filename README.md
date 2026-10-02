# dsh-model-modality

Per-model input-modality and reasoning-effort configuration for the DSH Models settings page.

[简体中文](README.zh-CN.md)

## Features

| Setting | Location | Configuration field |
| --- | --- | --- |
| Text / image input | Provider card in **Settings → Models** | `input` |
| Reasoning-effort levels | Expanded model row in the provider **Edit** dialog, beside context and output limits | `reasoningEfforts` |

The plugin targets providers managed by `@deepseek-ai/dsh-llm-pi-ai`. Settings are scoped to an individual model within a provider. The provider card contains input-type controls only; reasoning controls remain in the edit dialog.

These settings declare model capabilities. They do not add capabilities unsupported by the provider, generate images, or select the reasoning effort for an individual request.

## Compatibility

The UI patch has been verified against these versions:

| DSH | Models UI layout |
| --- | --- |
| `0.1.5-rc.1` with Models UI `0.1.5-rc.2` | Legacy model editor |
| `0.2.0-rc.2` | Shared `ModelRow` editor |

Compatibility with later versions is unverified. Reasoning controls depend on the structure of `@deepseek-ai/dsh-client-ui-settings-models`; an unsupported layout is reported without modifying the bundle.

Requirements:

- A DSH profile with the Web Models settings UI enabled.
- Providers managed by the pi-ai adapter family. Other adapter families are not modified.
- Write access to the installed Models UI bundle for the reasoning controls.

## Installation

```sh
dsh plugin --profile web add github:hmtxj/dsh-model-modality
```

Restart the target profile after installation, then open **Settings → Models**. The package declares its Cordis bundle; manual profile-manifest editing is not required.

For a development checkout:

```sh
git clone https://github.com/hmtxj/dsh-model-modality.git
dsh plugin --profile web add link:/absolute/path/to/dsh-model-modality
```

No build step or `prepare` script is required.

## Usage

### Input types

Each configured provider card lists the models served by that provider.

- **Text** is always enabled and cannot be unchecked in this control.
- Enable **Image** to write `input: [text, image]`.
- Disable **Image** to write `input: [text]`.

Input-type changes are saved immediately. Disabling image input writes an explicit text-only declaration rather than restoring a catalog default.

### Reasoning-effort levels

Open the provider's **Edit** dialog and expand a model row. The available declaration values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

Select only levels supported by the provider, then save through the dialog's normal save action.

- Selected levels replace the model's declaration with an identity mapping, such as `{ "high": "high", "max": "max" }`; `off` maps to `null`.
- Clear all levels to remove the explicit declaration and inherit the catalog configuration.
- An `off`-only selection is rejected because the adapter does not accept it.

Input-type writes update an existing `models` entry or, for catalog-backed providers, a `modelOverrides` entry. Reasoning declarations follow the native editor's save flow, which can create or update an explicit `models` list. Review the provider's model list before saving.

## UI patch and limitations

Input-type controls use the Models page's plugin extension slot. The supported provider edit dialogs have no equivalent slot, so the plugin applies a targeted patch to the installed Models UI bundle when the profile loads.

- The unmodified bundle is backed up beside it as `client.js.pre-thinking-patch` before a patch is written.
- Repeated loads do not apply the same patch twice.
- Missing anchors or write failures are logged. An unsupported layout is not patched.
- If a DSH update replaces the bundle, the plugin attempts to patch it on the next profile load; success still depends on layout compatibility.

Removing the plugin does not restore a bundle already patched. Restore only the backup belonging to that same bundle version after disabling the plugin.

The input-type API in this build requires a loopback `Host` header. A reverse proxy that forwards an external hostname may receive `403`; remote-proxy compatibility is not part of the verified scope.

## Development

```sh
npm test
```

The test suite covers the host route, both UI patch layouts, and the browser contribution. It runs without installing DSH; optional real-bundle checks operate on temporary copies.

See the [development guide](https://github.com/hmtxj/dsh-model-modality/blob/main/docs/DEVELOPMENT.md) for architecture, API details, and manual patch diagnostics. Report reproducible issues through [GitHub Issues](https://github.com/hmtxj/dsh-model-modality/issues).

## License

[MIT](LICENSE)
