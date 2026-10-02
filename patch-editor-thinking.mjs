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
//         DSH_MODALITY_TARGET=/path/to/lib/client.js node patch-editor-thinking.mjs
// Revert: copy client.js.pre-thinking-patch back over client.js.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { applyThinkingPatch, thinkingPatchState } from './thinking-patch.js'

const PACKAGE_TAIL = join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')

// An explicit target (argument or env var) is authoritative: if it is given and
// unreadable, say so rather than silently patching some other install.
const explicit = process.env.DSH_MODALITY_TARGET
  || (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '')

// Candidate locations for a global `npm i -g @deepseek-ai/dsh`, tried in order
// when no explicit target was given.
function candidates() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const appData = process.env.APPDATA || ''
  const prefix = process.env.npm_config_prefix || ''
  const tail = (base) => join(base, PACKAGE_TAIL)
  return [
    prefix ? tail(prefix) : '',
    appData ? tail(join(appData, 'npm', 'node_modules')) : '',
    home ? tail(join(home, '.npm-global', 'lib', 'node_modules')) : '',
    '/usr/local/lib/node_modules/' + PACKAGE_TAIL.split('\\').join('/'),
    '/usr/lib/node_modules/' + PACKAGE_TAIL.split('\\').join('/'),
    home ? tail(join(home, '.nvm', 'versions', 'node', process.version, 'lib', 'node_modules')) : ''
  ].filter(Boolean)
}

if (explicit && !existsSync(explicit)) {
  console.error(`patch: cannot read ${explicit}`)
  process.exit(1)
}

const TARGET = explicit || candidates().find((path) => existsSync(path))

if (!TARGET) {
  console.error('patch: cannot find the settings bundle. Pass it explicitly:')
  console.error('  node patch-editor-thinking.mjs /path/to/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js')
  console.error(`  (tried: ${candidates().join(' , ') || 'nothing — set DSH_MODALITY_TARGET'})`)
  process.exit(1)
}

const before = thinkingPatchState(TARGET)
const result = applyThinkingPatch(TARGET)

switch (result.status) {
  case 'applied':
    console.log(`patch: applied (${result.layout} layout) — edit dialog rows now carry the 思考等级 field`)
    console.log('patch: original kept at client.js.pre-thinking-patch (index.js re-applies this after every dsh upgrade)')
    break
  case 'present':
    console.log(`patch: already applied, nothing to do (${TARGET})`)
    break
  default:
    console.error(`patch: failed (${result.status}${result.layout ? `, ${result.layout} layout` : ''}): ${result.detail ?? ''}`)
    process.exit(1)
}

if (before === 'patched' && result.status === 'present') process.exit(0)
