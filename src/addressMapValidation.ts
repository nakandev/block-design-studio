export interface DraftAddressEntry { portId: string; baseAddress: string; size: string }

function parseHex(value: string): bigint | null {
  const trimmed = value.trim()
  return /^0x[0-9a-f]+$/i.test(trimmed) ? BigInt(trimmed) : null
}

export function validateAddressRanges(entries: DraftAddressEntry[], addressWidth: 32 | 64) {
  const maxAddress = (1n << BigInt(addressWidth)) - 1n
  const ranges = entries.map((entry) => {
    const base = parseHex(entry.baseAddress)
    const size = parseHex(entry.size)
    if (!entry.baseAddress.trim() && !entry.size.trim()) return { ...entry, status: 'Unassigned', end: null }
    if (base === null || size === null) return { ...entry, status: 'Invalid hexadecimal value', end: null }
    if (size < 1n || base > maxAddress || size > maxAddress + 1n) return { ...entry, status: 'Value outside address range', end: null }
    if (base % size !== 0n) return { ...entry, status: 'Base address is not size-aligned', end: null }
    const end = base + size - 1n
    if (end > maxAddress) return { ...entry, status: 'Address range overflow', end: null }
    return { ...entry, status: 'Valid', end }
  })
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].end === null) continue
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[j].end === null) continue
      if (parseHex(ranges[i].baseAddress)! <= ranges[j].end! && parseHex(ranges[j].baseAddress)! <= ranges[i].end!) {
        ranges[i].status = 'Address range overlaps another master'
        ranges[j].status = 'Address range overlaps another master'
      }
    }
  }
  return ranges
}
