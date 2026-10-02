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
 * Idempotent. Never throws, never exits — the caller decides what to log.
 * @returns {{status: 'applied'|'present'|'missing'|'anchor-missing'|'unreadable'|'unwritable', detail?: string}}
 */
export function applyThinkingPatch(target) {
  let source
  try {
    source = readFileSync(target, 'utf8')
  } catch (error) {
    return { status: 'unreadable', detail: error.message }
  }

  if (source.includes(MARKER)) return { status: 'present' }

  if (!source.includes(HELPER_ANCHOR)) {
    return { status: 'anchor-missing', detail: 'ModelListEditor destructure anchor not found — upstream layout changed; patch needs a re-read' }
  }

  const callAt = source.indexOf(CALL_ANCHOR)
  if (callAt === -1) {
    return { status: 'anchor-missing', detail: 'maxTokens capacity anchor not found — upstream layout changed; patch needs a re-read' }
  }

  // The advanced children array closes at the SECOND `})]` after the anchor:
  //   1st = input call close + maxTokens <label>'s children close
  //   2nd = `})` label props+call close, then `]` closes the modelAdvanced
  //         children array — the new field must land INSIDE that array, so the
  //         insert goes between the `)` and that final `]`.
  const closeAt = source.indexOf(CLOSE, callAt)
  const closeAt2nd = closeAt === -1 ? -1 : source.indexOf(CLOSE, closeAt + CLOSE.length)
  if (closeAt === -1 || closeAt2nd === -1) {
    return { status: 'anchor-missing', detail: 'advanced-area close anchors not found — upstream layout changed; patch needs a re-read' }
  }

  let patched = source.replace(HELPER_ANCHOR, HELPER_ANCHOR + '\n' + HELPER)
  if (patched === source) return { status: 'anchor-missing', detail: 'helper insertion failed' }

  // recompute the anchor offsets after the first insertion shifted the text
  const callAt2 = patched.indexOf(CALL_ANCHOR)
  const firstClose2 = patched.indexOf(CLOSE, callAt2)
  const arrayTailAt2 = patched.indexOf(CLOSE, firstClose2 + CLOSE.length) + 2
  patched = patched.slice(0, arrayTailAt2) + ', DshThinkingField(model, index, patch, disabled)' + patched.slice(arrayTailAt2)

  try {
    copyFileSync(target, target + '.pre-thinking-patch')
  } catch (error) {
    return { status: 'unwritable', detail: `could not back up original: ${error.message}` }
  }
  try {
    writeFileSync(target, patched)
  } catch (error) {
    return { status: 'unwritable', detail: error.message }
  }
  return { status: 'applied' }
}
