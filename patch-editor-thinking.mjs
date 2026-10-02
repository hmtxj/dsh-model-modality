// Manual CLI for the 思考等级 field patch (the plugin's index.js applies the
// same patch automatically at profile load — this script is for a one-off run
// or for inspecting state without restarting dsh).
//
// Patches the VENDOR dsh-client-ui-settings-models client bundle so the native
// provider EDIT dialog gains a per-model 思考等级 field (next to 上下文窗口 /
// 最大输出 token in a row's expanded area).
//
// Why patch the vendor file: the models settings UI exposes exactly two slots
// (settings.models.provider-card / settings.models.footer) — the edit dialog
// has no injection point, so a plugin can only add fields there by patching.
//
// Semantics (matches the adapter's reasoningEfforts validation):
//   - checkbox set = identity level->wire map, `off` -> null
//   - all unchecked = key removed = inherit from the installed catalog
//   - an off-only declaration is REFUSED (the adapter invalidates it at load;
//     writing one would break the next dsh boot) — the checkbox snaps back
//
// The original is kept beside it as client.js.pre-thinking-patch on first
// patch; delete that file only if you want to re-baseline.
//
// Usage:  node patch-editor-thinking.mjs [path/to/lib/client.js]
// Revert: copy client.js.pre-thinking-patch back over client.js.

import { existsSync } from 'node:fs'
import { applyThinkingPatch, thinkingPatchState } from './thinking-patch.js'

// Optional argument, else the well-known npm -g install location.
const DEFAULT_TARGET = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'
const TARGET = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : DEFAULT_TARGET

if (!existsSync(TARGET)) {
  console.error(`patch: cannot read ${TARGET}`)
  process.exit(1)
}

const before = thinkingPatchState(TARGET)
const result = applyThinkingPatch(TARGET)

switch (result.status) {
  case 'applied':
    console.log('patch: applied — edit dialog rows now carry the 思考等级 field')
    console.log('patch: original kept at client.js.pre-thinking-patch (index.js re-applies this after every dsh upgrade)')
    break
  case 'present':
    console.log('patch: already applied, nothing to do')
    break
  default:
    console.error(`patch: failed (${result.status}): ${result.detail ?? ''}`)
    process.exit(1)
}

if (before === 'patched' && result.status === 'present') process.exit(0)
