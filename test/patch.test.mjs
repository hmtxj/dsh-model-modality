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
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyThinkingPatch, thinkingPatchLayout, thinkingPatchState, MARKER, SETTINGS_MODELS_PACKAGE } from '../thinking-patch.js'

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

// The 0.2.0-rc.2 shape: the row became its own `ModelRow` component, shared by
// the pi-ai editor (inputField "input") and the DeepSeek editor (inputField
// "inputModalities"). The helper goes after ModelRow's destructure; the call
// goes after the ModelInputTypes element, i.e. between the `)` and the `]` of
// the first `})]` that follows `onChange: props.onChange`.
const SYNTHETIC_ROW = `\tfunction ModelRow(props) {
\t\tconst { model, position, t, disabled } = props;
\t\treturn (0, react_jsx_runtime.jsxs)("div", {
\t\t\tclassName: ModelsSection_module_css_default["modelEntry"],
\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\tclassName: ModelsSection_module_css_default["modelRow"],
\t\t\t\tchildren: [["id", "name"].map((field) => (0, react_jsx_runtime.jsx)("input", {
\t\t\t\t\tvalue: typeof model[field] === "string" ? model[field] : "",
\t\t\t\t\tonChange: (event) => {
\t\t\t\t\t\tprops.onFieldChange(field, event.target.value);
\t\t\t\t\t}
\t\t\t\t}, field))]
\t\t\t}), props.expanded ? (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\tclassName: ModelsSection_module_css_default["modelAdvanced"],
\t\t\t\tchildren: [["contextWindow", "maxTokens"].map((field) => (0, react_jsx_runtime.jsxs)("label", {
\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("input", {
\t\t\t\t\t\tvalue: props[field].value,
\t\t\t\t\t\tonChange: (event) => {
\t\t\t\t\t\t\tprops[field].onChange(event.target.value);
\t\t\t\t\t\t}
\t\t\t\t\t})]
\t\t\t\t}, field)), (0, react_jsx_runtime.jsx)(ModelInputTypes, {
\t\t\t\t\tmodel,
\t\t\t\t\tfield: props.inputField,
\t\t\t\t\tposition,
\t\t\t\t\tfallback: props.inputFallback,
\t\t\t\t\tdisabled: disabled || props.inputLoading === true,
\t\t\t\t\tt,
\t\t\t\t\tonChange: props.onChange
\t\t\t\t})]
\t\t\t}) : null]
\t\t});
\t}
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

  // --- layout detection ------------------------------------------------------
  assert.equal(thinkingPatchLayout(SYNTHETIC), 'legacy')
  assert.equal(thinkingPatchLayout(SYNTHETIC_ROW), 'row')
  assert.equal(thinkingPatchLayout('window.__ModuleLoader__.load({});'), 'unknown')
  // The two layouts' helper anchors must not overlap: a bundle carrying one must
  // never be mistaken for the other, or a 0.2.0 install would get the legacy
  // insertion and ReferenceError on first render.
  assert.equal(SYNTHETIC_ROW.includes('const { models, onChange, probe, operations, t, disabled } = props;'), false)
  assert.equal(SYNTHETIC.includes('function ModelRow(props) {'), false)

  // --- 0.2.0-rc.2 layout: pristine -> patched --------------------------------
  const rowScratch = join(dir, 'row-client.js')
  writeFileSync(rowScratch, SYNTHETIC_ROW)
  assert.equal(thinkingPatchState(rowScratch), 'pristine')

  const rowApplied = applyThinkingPatch(rowScratch)
  assert.equal(rowApplied.status, 'applied')
  assert.equal(rowApplied.layout, 'row')

  const rowPatched = readFileSync(rowScratch, 'utf8')
  assert.equal(thinkingPatchState(rowScratch), 'patched')
  assert.ok(rowPatched.includes(MARKER), 'the marker must land in the file')
  assert.ok(rowPatched.includes('function DSH_THINKING_ROW_LEVELS()'), 'the level table must be inserted')
  assert.ok(rowPatched.includes('function DshThinkingRowField('), 'the field renderer must be inserted')
  // The helper must land inside ModelRow's body, after its opening line and
  // before the returned element. (Inserted at the very top of the body, which is
  // fine: function declarations hoist, and the closure variables it uses —
  // react_jsx_runtime, ModelsSection_module_css_default — are factory-scoped.)
  const helperAt = rowPatched.indexOf('function DshThinkingRowField(')
  const rowOpenAt = rowPatched.indexOf('function ModelRow(props) {')
  const rowReturnAt = rowPatched.indexOf('return (0, react_jsx_runtime.jsxs)("div", {', rowOpenAt)
  assert.ok(rowOpenAt < helperAt && helperAt < rowReturnAt, 'the helper must sit inside ModelRow, before its returned element')
  // The call must sit INSIDE the modelAdvanced children array, right after the
  // ModelInputTypes element — i.e. the element's `})` is followed by a comma,
  // the new element, and only then the array's closing `]`.
  assert.match(rowPatched, /\}\),\n\t+props\.inputField === "input" && typeof props\.onFieldChange === "function" \? DshThinkingRowField\(model, position, disabled, \(value\) => props\.onFieldChange\("reasoningEfforts", value\)\) : null\]/)
  // The call must be inside the modelAdvanced children array. Note the search
  // text is the CALL, not the helper's `function DshThinkingRowField(...)`
  // definition, which sits earlier in the file.
  const CALL_TEXT = 'DshThinkingRowField(model, position, disabled, (value)'
  const advancedAt = rowPatched.indexOf('ModelsSection_module_css_default["modelAdvanced"]')
  const callAt = rowPatched.indexOf(CALL_TEXT)
  const advancedEnd = rowPatched.indexOf('}) : null]', callAt)
  assert.ok(callAt !== -1, 'the call must be inserted')
  assert.ok(advancedAt < callAt && callAt < advancedEnd, 'the call must be inside the modelAdvanced children array')
  // The call must be guarded to the pi-ai route: llm-deepseek has no
  // reasoningEfforts, so the DeepSeek editor must render nothing here.
  assert.ok(rowPatched.includes('props.inputField === "input"'), 'the call must be guarded to the pi-ai route')
  assert.ok(rowPatched.includes('props.onFieldChange("reasoningEfforts", value)'), 'the write must go through onFieldChange')
  // Back-up of the original is kept beside the patched file.
  assert.equal(readFileSync(`${rowScratch}.pre-thinking-patch`, 'utf8'), SYNTHETIC_ROW)

  // --- 0.2.0-rc.2 layout: idempotent ----------------------------------------
  assert.equal(applyThinkingPatch(rowScratch).status, 'present')
  assert.equal(readFileSync(rowScratch, 'utf8'), rowPatched)

  // --- 0.2.0-rc.2 layout: drift is reported, not thrown ---------------------
  const rowDrifted = join(dir, 'row-drifted.js')
  writeFileSync(rowDrifted, SYNTHETIC_ROW.replace('onChange: props.onChange', 'onChange: props.onInputChange'))
  const rowDriftedResult = applyThinkingPatch(rowDrifted)
  assert.equal(rowDriftedResult.status, 'anchor-missing')
  assert.equal(rowDriftedResult.layout, 'row', 'the layout must still be reported so the log names the drifted anchor')
  assert.match(rowDriftedResult.detail, /ModelRow onChange anchor not found/)
  assert.equal(readFileSync(rowDrifted, 'utf8').includes(MARKER), false, 'a failed patch must not write')

  // --- legacy layout drift names the legacy anchor --------------------------
  const legacyDrifted = join(dir, 'legacy-drifted.js')
  writeFileSync(legacyDrifted, SYNTHETIC.replace('editCapacity(index, "maxTokens", event.target.value);', 'props.onChange(event.target.value);'))
  const legacyDriftedResult = applyThinkingPatch(legacyDrifted)
  assert.equal(legacyDriftedResult.status, 'anchor-missing')
  assert.equal(legacyDriftedResult.layout, 'legacy')
  assert.match(legacyDriftedResult.detail, /maxTokens capacity anchor not found/)
  assert.equal(readFileSync(legacyDrifted, 'utf8').includes(MARKER), false, 'a failed patch must not write')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// --- optional: byte-for-byte agreement with a real install -------------------
// Override with DSH_MODALITY_REAL_DIR=<...>/lib to point at another install
// (e.g. a Linux box, where the path differs).
const bundleTail = join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib')
const realCandidates = [
  process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', bundleTail),
  process.env.npm_config_prefix && join(process.env.npm_config_prefix, 'node_modules', bundleTail),
  process.env.npm_config_prefix && join(process.env.npm_config_prefix, 'lib', 'node_modules', bundleTail),
  join(homedir(), '.npm-global', 'lib', 'node_modules', bundleTail),
  join(homedir(), '.nvm', 'versions', 'node', process.version, 'lib', 'node_modules', bundleTail),
  join('/usr/local/lib/node_modules', bundleTail),
  join('/usr/lib/node_modules', bundleTail),
].filter(Boolean)
const REAL_DIR = process.env.DSH_MODALITY_REAL_DIR
  || realCandidates.find((candidate) => existsSync(join(candidate, 'client.js')))
const realBaseline = REAL_DIR && join(REAL_DIR, 'client.js.pre-thinking-patch')
const realLive = REAL_DIR && join(REAL_DIR, 'client.js')

if (realBaseline && realLive && existsSync(realBaseline) && existsSync(realLive)) {
  // A patched bundle plus its pre-patch baseline: the module must reproduce it
  // exactly, which is what pins the legacy insertion to the shipped bytes.
  const probe = join(tmpdir(), `dsh-modality-real-${process.pid}.js`)
  try {
    copyFileSync(realBaseline, probe)
    const layout = thinkingPatchLayout(readFileSync(probe, 'utf8'))
    assert.equal(applyThinkingPatch(probe).status, 'applied')
    assert.equal(readFileSync(probe, 'utf8'), readFileSync(realLive, 'utf8'), 'the module must reproduce the shipped patched bundle byte for byte')
    console.log(`patch half: real ${layout} bundle reproduced byte for byte`)
  } finally {
    rmSync(probe, { force: true })
    rmSync(`${probe}.pre-thinking-patch`, { force: true })
  }
} else if (realLive && existsSync(realLive)) {
  // No baseline, but a real bundle: check the live bytes directly when they are
  // still pristine (the normal state on a machine whose patch never applied,
  // e.g. a fresh 0.2.0-rc.2 install).
  const source = readFileSync(realLive, 'utf8')
  const layout = thinkingPatchLayout(source)
  if (source.includes(MARKER)) {
    console.log(`patch half: real ${layout} bundle is already patched — synthetic checks only`)
  } else if (layout === 'unknown') {
    console.log('patch half: real bundle matches neither layout — synthetic checks only')
  } else {
    const probe = join(tmpdir(), `dsh-modality-real-${process.pid}.js`)
    try {
      copyFileSync(realLive, probe)
      const result = applyThinkingPatch(probe)
      assert.equal(result.status, 'applied', `a pristine real ${layout} bundle must patch`)
      assert.equal(result.layout, layout)
      const patched = readFileSync(probe, 'utf8')
      assert.ok(patched.includes(MARKER))
      const callAt = layout === 'row'
        ? patched.indexOf('DshThinkingRowField(model, position, disabled, (value)')
        : patched.indexOf(', DshThinkingField(model, index, patch, disabled)')
      assert.ok(callAt !== -1, 'the call must be inserted into the real bundle')
      const advancedAt = patched.lastIndexOf('modelAdvanced', callAt)
      assert.ok(advancedAt !== -1 && advancedAt < callAt, 'the call must be inside the advanced area')
      assert.equal(applyThinkingPatch(probe).status, 'present')
      assert.equal(readFileSync(probe, 'utf8'), patched, 'a second run must not change the file')
      console.log(`patch half: real pristine ${layout} bundle patched and verified`)
    } finally {
      rmSync(probe, { force: true })
      rmSync(`${probe}.pre-thinking-patch`, { force: true })
    }
  }
} else {
  console.log('patch half: no real bundle on this machine — synthetic checks only')
}

assert.equal(SETTINGS_MODELS_PACKAGE, '@deepseek-ai/dsh-client-ui-settings-models')
console.log('patch half: all checks passed')
