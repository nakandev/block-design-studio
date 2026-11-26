import type { ParameterValue } from './types'

// Evaluate only a conservative integer subset; unsupported HDL remains unknown.
export function resolveWidth(expression: number | string, parameters: Record<string, ParameterValue>): number | undefined {
  const evaluate = (input: string, resolving: Set<string>, depth: number): number | undefined => {
    if (depth > 32 || input.length > 1024) return undefined
    const tokens = input.match(/\s*(?:\d[\d_]*|[A-Za-z_$][A-Za-z0-9_$]*|<<|>>|[()+\-*/])/g)
    if (!tokens || tokens.join('').trim() !== input.trim() || tokens.length > 128) return undefined
    const parts = tokens.map((token) => token.trim())
    let index = 0
    const parse = (minPrecedence: number, level: number): number | undefined => {
      if (level > 64) return undefined
      const token = parts[index++]
      let left: number | undefined
      if (token === '(') {
        left = parse(0, level + 1)
        if (parts[index++] !== ')') return undefined
      } else if (token === '+' || token === '-') {
        const value = parse(3, level + 1)
        left = value === undefined ? undefined : token === '-' ? -value : value
      } else if (token && /^\d[\d_]*$/.test(token)) {
        left = Number(token.replace(/_/g, ''))
      } else if (token && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) && Object.prototype.hasOwnProperty.call(parameters, token) && !resolving.has(token)) {
        const raw = parameters[token]
        const value = typeof raw === 'object' ? raw.value : raw
        if (typeof value === 'string' || typeof value === 'number') left = evaluate(String(value), new Set([...resolving, token]), depth + 1)
      }
      if (left === undefined || !Number.isSafeInteger(left)) return undefined
      while (index < parts.length) {
        const operator = parts[index]
        const precedence = operator === '<<' || operator === '>>' ? 0 : operator === '+' || operator === '-' ? 1 : operator === '*' || operator === '/' ? 2 : -1
        if (precedence < minPrecedence) break
        index++
        const right = parse(precedence + 1, level + 1)
        if (right === undefined) return undefined
        if (operator === '+') left += right
        else if (operator === '-') left -= right
        else if (operator === '*') left *= right
        else if (operator === '/') {
          if (!right || left % right !== 0) return undefined
          left /= right
        } else {
          if (left < 0 || right < 0 || right > 52) return undefined
          left = operator === '<<' ? left * 2 ** right : Math.floor(left / 2 ** right)
        }
        if (!Number.isSafeInteger(left)) return undefined
      }
      return left
    }
    const value = parse(0, 0)
    return index === parts.length ? value : undefined
  }
  const value = evaluate(String(expression), new Set(), 0)
  return value !== undefined && value > 0 ? value : undefined
}
