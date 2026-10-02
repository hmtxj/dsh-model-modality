// Offline tests for the 思考等级 patch module (thinking-patch.js).
//
// The patch edits the shipped dsh-client-ui-settings-models bundle, so the real
// subject only exists inside an installed dsh. These tests therefore drive the
// anchor mechanics against a SYNTHETIC bundle shaped like the real one, and —
// when this machine happens to have a real baseline beside the live bundle —
// additionally assert the patch reproduces that machine's patched file byte for
// byte. Run with `node test/patch.test.mjs`.

import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyThinkingPatch, thinkingPatchState, MARKER, SETTINGS_MODELS_PACKAGE } from '../thinking-patch.js'

// A miniature stand-in with the two anchors and the `})]` nesting the real
// bundle has: the helper goes right after the destructure, the call goes inside
// the modelAdvanced children array (between the 2nd `})` and its closing `]`).
const SYNTHETIC = `const { models, onChange, probe, operations, t, disabled } = props;
		const modelAdvanced = (index, model) => [(0, react_jsx_runtime.jsxs)("label", {
			children: [(0, react_jsx_runtime.jsx)("input", {
				onChange: (event) => {
					editCapacity(index, "maxTokens", event.target.value);
				}
			})]
		})];
`

const dir = mkdtempSync(join(tmpdir(), 'dsh-modality-patch-'))
const scratch = join(dir, 'client.js')

try {
  // --- pristine -> patched ---------------------------------------------------
  writeFileSync(scratch, SYNTHETIC)
  assert.equal(thinkingPatchState(scratch), 'pristine')

  const applied = applyThinkingPatch(scratch)
  assert.equal(applied.status, 'applied')

  const patched = readFileSync(scratch, 'utf8')
  assert.equal(thinkingPatchState(scratch), 'patched')
  assert.ok(patched.includes(MARKER), 'the marker must land in the file')
  assert.ok(patched.includes('function DSH_THINKING_LEVELS()'), 'the level table must be inserted')
  assert.ok(patched.includes('function DshThinkingField('), 'the field renderer must be inserted')
  // The field must sit INSIDE the advanced children array, not after it.
  assert.match(patched, /DshThinkingField\(model, index, patch, disabled\)\]/)
  // The helper must land after the destructure anchor, before the row builder.
  assert.ok(patched.indexOf('function DshThinkingField(') > patched.indexOf('const { models, onChange'))
  assert.ok(patched.indexOf('function DshThinkingField(') < patched.indexOf('const modelAdvanced'))
  // Back-up of the original is kept beside the patched file.
  assert.equal(readFileSync(`${scratch}.pre-thinking-patch`, 'utf8'), SYNTHETIC)

  // --- idempotent: a second run changes nothing ------------------------------
  assert.equal(applyThinkingPatch(scratch).status, 'present')
  assert.equal(readFileSync(scratch, 'utf8'), patched)

  // --- upstream drift is reported, not thrown --------------------------------
  const drifted = join(dir, 'drifted.js')
  writeFileSync(drifted, SYNTHETIC.replace('const { models, onChange, probe, operations, t, disabled } = props;', 'const { models } = props;'))
  const driftedResult = applyThinkingPatch(drifted)
  assert.equal(driftedResult.status, 'anchor-missing')
  assert.match(driftedResult.detail, /upstream layout changed/)
  assert.equal(readFileSync(drifted, 'utf8').includes(MARKER), false, 'a failed patch must not write')

  // --- missing target --------------------------------------------------------
  assert.equal(applyThinkingPatch(join(dir, 'nope.js')).status, 'unreadable')
  assert.equal(thinkingPatchState(join(dir, 'nope.js')), 'missing')
  assert.equal(thinkingPatchState(undefined), 'missing')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// --- optional: byte-for-byte agreement with a real install -------------------
const REAL_DIR = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib'
const realBaseline = `${REAL_DIR}/client.js.pre-thinking-patch`
const realLive = `${REAL_DIR}/client.js`

if (existsSync(realBaseline) && existsSync(realLive)) {
  const probe = join(tmpdir(), `dsh-modality-real-${process.pid}.js`)
  try {
    copyFileSync(realBaseline, probe)
    assert.equal(applyThinkingPatch(probe).status, 'applied')
    assert.equal(readFileSync(probe, 'utf8'), readFileSync(realLive, 'utf8'), 'the module must reproduce the shipped patched bundle byte for byte')
    console.log('patch half: real bundle reproduced byte for byte')
  } finally {
    rmSync(probe, { force: true })
    rmSync(`${probe}.pre-thinking-patch`, { force: true })
  }
} else {
  console.log('patch half: no real bundle on this machine — synthetic checks only')
}

assert.equal(SETTINGS_MODELS_PACKAGE, '@deepseek-ai/dsh-client-ui-settings-models')
console.log('patch half: all checks passed')
