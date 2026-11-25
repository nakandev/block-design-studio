import type { BlockData, BlockTemplate, DefineValue, ParameterSetting } from './types'

function entries(value: unknown, description: string): [string, unknown][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} must be an object`)
  return Object.entries(value).map(([name, item]) => {
    if (!name.trim()) throw new Error(`${description} contains an empty name`)
    return [name, item]
  })
}

export function validateBlockSettings(template: Record<string, unknown>, kind: string): Pick<BlockTemplate, 'parameters' | 'defines'> {
  const parameters = template.parameters === undefined ? [] : entries(template.parameters, `Parameters in ${kind}`).map(([name, value]): [string, ParameterSetting] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid parameter ${name} in ${kind}: expected an object`)
    const parameter = value as Record<string, unknown>
    if (typeof parameter.type !== 'string' || !parameter.type.trim() || typeof parameter.value !== 'string') throw new Error(`Invalid parameter ${name} in ${kind}: expected a nonempty type and a string value or expression`)
    return [name, { type: parameter.type, value: parameter.value }]
  })
  const defines = template.defines === undefined ? [] : entries(template.defines, `Defines in ${kind}`).map(([name, value]): [string, DefineValue] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid define ${name} in ${kind}: expected an object`)
    const define = value as Record<string, unknown>
    if (typeof define.enabled !== 'boolean' || (define.value !== undefined && typeof define.value !== 'string')) throw new Error(`Invalid define ${name} in ${kind}: expected enabled boolean and optional string value`)
    return [name, { enabled: define.enabled, value: define.value ?? '' }]
  })
  return { parameters: Object.fromEntries(parameters), defines: Object.fromEntries(defines) }
}

export function mergeBlockSettings(data: BlockData, template: BlockTemplate): BlockData {
  let parameters = { ...data.parameters }
  let defines = { ...data.defines }
  let changed = false
  for (const [name, value] of Object.entries(template.parameters ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(parameters, name)) {
      parameters = { ...parameters, [name]: { ...value } }
      changed = true
    } else if (typeof parameters[name] !== 'object') {
      parameters = { ...parameters, [name]: { type: value.type, value: String(parameters[name]) } }
      changed = true
    }
  }
  for (const [name, value] of Object.entries(template.defines ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(defines, name)) { defines = { ...defines, [name]: { ...value } }; changed = true }
  }
  return changed ? { ...data, parameters, defines } : data
}
