import { validateBlockSettings } from './blockSettings'
import type { InterfaceDefinition, InterfaceSignal } from './types'

export function validateInterfaceSignals(item: Record<string, unknown>, name: string): Pick<InterfaceDefinition, 'parameters' | 'signals' | 'masterSignals' | 'slaveSignals'> {
  const parameters = item.parameters === undefined ? undefined : validateBlockSettings({ parameters: item.parameters }, `interface ${name}`).parameters
  const readSignals = (key: 'signals' | 'masterSignals' | 'slaveSignals'): InterfaceSignal[] | undefined => {
    const value = item[key]
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw new Error(`Invalid ${key} in interface ${name}: expected an array`)
    const names = new Set<string>()
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid ${key} signal ${index + 1} in interface ${name}`)
      const signal = entry as Record<string, unknown>
      if (typeof signal.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(signal.name) ||
        (signal.direction !== 'input' && signal.direction !== 'output') ||
        !((typeof signal.width === 'number' && Number.isSafeInteger(signal.width) && signal.width > 0) || (typeof signal.width === 'string' && signal.width.trim()))) {
        throw new Error(`Invalid ${key} signal ${index + 1} in interface ${name}: expected a name, direction and positive width or expression`)
      }
      if (names.has(signal.name)) throw new Error(`Duplicate signal ${signal.name} in interface ${name} ${key}`)
      names.add(signal.name)
      return { name: signal.name, direction: signal.direction, width: signal.width as number | string }
    })
  }
  const signals = readSignals('signals')
  const masterSignals = readSignals('masterSignals')
  const slaveSignals = readSignals('slaveSignals')
  const common = new Set(signals?.map((signal) => signal.name))
  for (const signal of [...(masterSignals ?? []), ...(slaveSignals ?? [])]) {
    if (common.has(signal.name)) throw new Error(`Duplicate signal ${signal.name} in interface ${name} common and role-specific signals`)
  }
  return { ...(parameters ? { parameters } : {}), ...(signals ? { signals } : {}), ...(masterSignals ? { masterSignals } : {}), ...(slaveSignals ? { slaveSignals } : {}) }
}

export function interfaceSignals(definition: InterfaceDefinition, side: 'master' | 'slave'): InterfaceSignal[] {
  const common = (definition.signals ?? []).map((signal) => ({
    ...signal,
    direction: side === 'master' ? signal.direction : signal.direction === 'input' ? 'output' as const : 'input' as const,
  }))
  return [...common, ...(side === 'master' ? definition.masterSignals ?? [] : definition.slaveSignals ?? []).map((signal) => ({ ...signal }))]
}
