// The 思考等级 field patch for the native provider EDIT dialog, as a module.
//
// Why this exists at all: the models settings page exposes exactly two slots
// (settings.models.provider-card / settings.models.footer) and the provider
// EDIT dialog exposes none, so the only way to put a per-model 思考等级 field
// inside that dialog is to patch the shipped settings bundle.
//
// index.js calls applyThinkingPatch() at profile load, locating the bundle
// through ctx.clientModules.clientPath() — no hard-coded install path, and the
// patch is re-applied automatically after every `npm i -g @deepseek-ai/dsh`
// (an upgrade rewrites the bundle back to pristine, the marker disappears, and
// the next boot patches it again).
//
// patch-editor-thinking.mjs is the manual CLI for the same operation.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

export const MARKER = 'dsh-thinking-field-patch'
export const SETTINGS_MODELS_PACKAGE = '@deepseek-ai/dsh-client-ui-settings-models'

// --- insertion 1: the field renderer, inside the module-loader factory ------
// (react_jsx_runtime / ModelsSection_module_css_default live in the factory's
// closure — inserting at top level compiles but throws ReferenceError on
// first render, which React answers by silently unmounting the section)
const HELPER_ANCHOR = 'const { models, onChange, probe, operations, t, disabled } = props;'

const HELPER = `/* ${MARKER} v1: per-model thinking-level declaration in the edit dialog.
 * Checkbox set = identity level->wire map (off -> null); all unchecked = key
 * removed = inherit. An off-only pick is refused: the adapter invalidates it
 * at profile load, so writing one would break the next boot. */
		function DSH_THINKING_LEVELS() {
			return [["off", "关"], ["minimal", "最小"], ["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "超高"], ["max", "Max"]];
		}
		function DshThinkingField(model, index, patch, disabled) {
			const declared = model.reasoningEfforts && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : {};
			const checkedOf = (level) => {
				const wire = declared[level];
				return wire === null ? level === "off" : typeof wire === "string" && wire.length > 0;
			};
			return (0, react_jsx_runtime.jsxs)("label", {
				className: ModelsSection_module_css_default["modelField"],
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ModelsSection_module_css_default["modelFieldLabel"],
					children: "思考等级"
				}), (0, react_jsx_runtime.jsx)("span", {
					style: { display: "flex", flexWrap: "wrap", gap: "4px 12px", padding: "3px 0" },
					children: DSH_THINKING_LEVELS().map((pair) => (0, react_jsx_runtime.jsxs)("label", {
						style: { display: "inline-flex", alignItems: "center", gap: "4px", cursor: disabled ? "default" : "pointer", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
						title: pair[0] === "off" ? "off：仅勾「关」无效，需至少再勾一个其他档位" : pair[0],
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: checkedOf(pair[0]),
							disabled: disabled,
							"aria-label": \`思考等级 \${pair[1]} \${index + 1}\`,
							onChange: (event) => {
								const current = model.reasoningEfforts && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : {};
								const picked = DSH_THINKING_LEVELS().map((pair) => pair[0]).filter((level) => {
									if (level === pair[0]) return event.target.checked;
									const wire = current[level];
									return wire === null ? level === "off" : typeof wire === "string" && wire.length > 0;
								});
								if (picked.length === 1 && picked[0] === "off") return;
								patch(index, { reasoningEfforts: picked.length === 0 ? void 0 : Object.fromEntries(picked.map((level) => [level, level === "off" ? null : level])) });
							}
						}), (0, react_jsx_runtime.jsx)("span", { children: pair[1] })]
					}, pair[0]))
				})]
			});
		}
`

// --- insertion 2: the field call, after the maxTokens label in the ----------
// expanded advanced area of ModelListEditor's rows.
const CALL_ANCHOR = 'editCapacity(index, "maxTokens", event.target.value);'
const CLOSE = '})]'

// ===========================================================================
// Layout B — DSH >= 0.2.0-rc.2, where the model row became its own component.
//
// 0.2.0-rc.2 rewrote the row as `ModelRow`, shared by TWO editors:
//   * the pi-ai editor   -> inputField: "input"            (has reasoningEfforts)
//   * the DeepSeek editor -> inputField: "inputModalities" (llm-deepseek has no
//     reasoningEfforts at all, so the field must not render there)
// The call site below therefore guards on inputField === "input".
//
// The write path also changed: 0.2.0-rc.2 has no `patch(index, next)` reachable
// from the row, so the field takes a `write` callback. ModelListEditor wires it
// to onFieldChange -> patch(index, { [field]: value }), and that patch deletes
// any key whose value is undefined or "" — so write(void 0) means "inherit",
// exactly like the legacy branch.
//
// The legacy text above is deliberately left byte-identical: bundles already
// patched on 0.1.5 keep their exact bytes, and the byte-for-byte regression
// test against a real 0.1.5 install keeps passing.
// ===========================================================================

const ROW_HELPER_ANCHOR = 'function ModelRow(props) {'
const ROW_CALL_ANCHOR = 'onChange: props.onChange'

const ROW_HELPER = `/* ${MARKER} v2: per-model thinking-level declaration in the edit dialog.
 * Layout B (DSH >= 0.2.0-rc.2): the row is a shared ModelRow component, so the
 * call site renders this only for the pi-ai route (inputField === "input");
 * the DeepSeek route declares inputModalities and has no reasoningEfforts.
 * Checkbox set = identity level->wire map (off -> null); all unchecked = key
 * removed = inherit. An off-only pick is refused: the adapter invalidates it
 * at profile load, so writing one would break the next boot. */
		function DSH_THINKING_ROW_LEVELS() {
			return [["off", "关"], ["minimal", "最小"], ["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "超高"], ["max", "Max"]];
		}
		function DshThinkingRowField(model, position, disabled, write) {
			const declared = model.reasoningEfforts && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : {};
			const checkedOf = (level) => {
				const wire = declared[level];
				return wire === null ? level === "off" : typeof wire === "string" && wire.length > 0;
			};
			return (0, react_jsx_runtime.jsxs)("label", {
				className: ModelsSection_module_css_default["modelField"],
				style: { gridColumn: "1 / -1" },
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ModelsSection_module_css_default["modelFieldLabel"],
					children: "思考等级"
				}), (0, react_jsx_runtime.jsx)("span", {
					style: { display: "flex", flexWrap: "wrap", gap: "4px 12px", padding: "3px 0" },
					children: DSH_THINKING_ROW_LEVELS().map((pair) => (0, react_jsx_runtime.jsxs)("label", {
						style: { display: "inline-flex", alignItems: "center", gap: "4px", cursor: disabled ? "default" : "pointer", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
						title: pair[0] === "off" ? "off：仅勾「关」无效，需至少再勾一个其他档位" : pair[0],
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: checkedOf(pair[0]),
							disabled: disabled,
							"aria-label": \`思考等级 \${pair[1]} \${position}\`,
							onChange: (event) => {
								const current = model.reasoningEfforts && typeof model.reasoningEfforts === "object" ? model.reasoningEfforts : {};
								const picked = DSH_THINKING_ROW_LEVELS().map((pair) => pair[0]).filter((level) => {
									if (level === pair[0]) return event.target.checked;
									const wire = current[level];
									return wire === null ? level === "off" : typeof wire === "string" && wire.length > 0;
								});
								if (picked.length === 1 && picked[0] === "off") return;
								write(picked.length === 0 ? void 0 : Object.fromEntries(picked.map((level) => [level, level === "off" ? null : level])));
							}
						}), (0, react_jsx_runtime.jsx)("span", { children: pair[1] })]
					}, pair[0]))
				})]
			});
		}
		`

const ROW_CALL =
  'props.inputField === "input" && typeof props.onFieldChange === "function"' +
  ' ? DshThinkingRowField(model, position, disabled, (value) => props.onFieldChange("reasoningEfforts", value))' +
  ' : null'

/** 'patched' | 'pristine' | 'missing' */
export function thinkingPatchState(target) {
  if (!target || !existsSync(target)) return 'missing'
  try {
    return readFileSync(target, 'utf8').includes(MARKER) ? 'patched' : 'pristine'
  } catch {
    return 'missing'
  }
}

/**
 * Which upstream layout this bundle has, by helper-anchor presence. The two
 * helper anchors are disjoint in practice (measured: legacy 1/0, row 0/1), so
 * this is a reliable discriminator rather than a heuristic. It deliberately
 * keys on the helper anchor only, so that a bundle whose *call* anchor drifted
 * still reports its layout and gets a precise "call anchor missing" detail.
 * @returns {'legacy'|'row'|'unknown'}
 */
export function thinkingPatchLayout(source) {
  if (source.includes(HELPER_ANCHOR)) return 'legacy'
  if (source.includes(ROW_HELPER_ANCHOR)) return 'row'
  return 'unknown'
}

/**
 * Idempotent. Never throws, never exits — the caller decides what to log.
 * Handles both upstream layouts; see the Layout B comment above.
 * @returns {{status: 'applied'|'present'|'missing'|'anchor-missing'|'unreadable'|'unwritable', layout?: string, detail?: string}}
 */
export function applyThinkingPatch(target) {
  let source
  try {
    source = readFileSync(target, 'utf8')
  } catch (error) {
    return { status: 'unreadable', detail: error.message }
  }

  if (source.includes(MARKER)) return { status: 'present' }

  const layout = thinkingPatchLayout(source)

  if (layout === 'unknown') {
    return {
      status: 'anchor-missing',
      layout,
      detail: 'neither the ModelListEditor destructure anchor (<= 0.1.5) nor the ModelRow anchor (>= 0.2.0-rc.2) was found — upstream layout changed; patch needs a re-read'
    }
  }

  let patched

  if (layout === 'legacy') {
    // --- Layout A: DSH <= 0.1.5 ---------------------------------------------
    const callAt = source.indexOf(CALL_ANCHOR)
    if (callAt === -1) {
      return { status: 'anchor-missing', layout, detail: 'maxTokens capacity anchor not found — upstream layout changed; patch needs a re-read' }
    }

    // The advanced children array closes at the SECOND `})]` after the anchor:
    //   1st = input call close + maxTokens <label>'s children close
    //   2nd = `})` label props+call close, then `]` closes the modelAdvanced
    //         children array — the new field must land INSIDE that array, so the
    //         insert goes between the `)` and that final `]`.
    const closeAt = source.indexOf(CLOSE, callAt)
    const closeAt2nd = closeAt === -1 ? -1 : source.indexOf(CLOSE, closeAt + CLOSE.length)
    if (closeAt === -1 || closeAt2nd === -1) {
      return { status: 'anchor-missing', layout, detail: 'advanced-area close anchors not found — upstream layout changed; patch needs a re-read' }
    }

    patched = source.replace(HELPER_ANCHOR, HELPER_ANCHOR + '\n' + HELPER)
    if (patched === source) return { status: 'anchor-missing', layout, detail: 'helper insertion failed' }

    // recompute the anchor offsets after the first insertion shifted the text
    const callAt2 = patched.indexOf(CALL_ANCHOR)
    const firstClose2 = patched.indexOf(CLOSE, callAt2)
    const arrayTailAt2 = patched.indexOf(CLOSE, firstClose2 + CLOSE.length) + 2
    patched = patched.slice(0, arrayTailAt2) + ', DshThinkingField(model, index, patch, disabled)' + patched.slice(arrayTailAt2)
  } else {
    // --- Layout B: DSH >= 0.2.0-rc.2 ----------------------------------------
    // The call goes into the modelAdvanced children array, right after the
    // ModelInputTypes element. In this layout the element ends with
    //     onChange: props.onChange
    //     })]            <- closes ModelInputTypes' props, then the children array
    //     }) : null]     <- closes the modelAdvanced div's props, then its ternary
    // so the new element is inserted between the `)` and the `]` of the FIRST
    // `})]` after the anchor — i.e. the ModelInputTypes element is turned into
    // one array entry followed by a comma and the thinking field.
    const rowCallAt = source.indexOf(ROW_CALL_ANCHOR)
    if (rowCallAt === -1) {
      return { status: 'anchor-missing', layout, detail: 'ModelRow onChange anchor not found — upstream layout changed; patch needs a re-read' }
    }
    const rowCloseAt = source.indexOf(CLOSE, rowCallAt)
    if (rowCloseAt === -1) {
      return { status: 'anchor-missing', layout, detail: 'ModelInputTypes close anchor not found — upstream layout changed; patch needs a re-read' }
    }

    patched = source.replace(ROW_HELPER_ANCHOR, ROW_HELPER_ANCHOR + '\n' + ROW_HELPER)
    if (patched === source) return { status: 'anchor-missing', layout, detail: 'helper insertion failed' }

    // recompute after the first insertion shifted the text
    const rowCallAt2 = patched.indexOf(ROW_CALL_ANCHOR)
    const rowCloseAt2 = patched.indexOf(CLOSE, rowCallAt2)
    const arrayTail2 = rowCloseAt2 + 2
    patched = patched.slice(0, arrayTail2) + ',\n\t\t\t\t\t' + ROW_CALL + patched.slice(arrayTail2)
  }

  try {
    copyFileSync(target, target + '.pre-thinking-patch')
  } catch (error) {
    return { status: 'unwritable', layout, detail: `could not back up original: ${error.message}` }
  }
  try {
    writeFileSync(target, patched)
  } catch (error) {
    return { status: 'unwritable', layout, detail: error.message }
  }
  return { status: 'applied', layout }
}
