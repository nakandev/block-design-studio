import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, validateDesign
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ validateDesign } = await server.ssrLoadModule('/src/designValidation.ts'))
})
after(async () => { await server?.close() })

const node = (id, ports, addressMap) => ({ id, type: 'block', position: { x: 0, y: 0 }, data: { label: id, kind: id, ports, parameters: {}, ...(addressMap ? { addressMap } : {}) } })
const port = (id, direction, width = 8) => ({ id, name: id, direction, width })
const edge = (id, source, sourceHandle, target, targetHandle) => ({ id, source, sourceHandle, target, targetHandle })

test('reports independent connection errors and unconnected ports', () => {
  const nodes = [node('a', [port('out', 'output'), port('unused', 'input')]), node('b', [port('in', 'input', 16)])]
  const edges = [edge('width', 'a', 'out', 'b', 'in'), edge('duplicate', 'a', 'out', 'b', 'in'), edge('missing', 'a', 'out', 'b', 'gone')]
  const issues = validateDesign(nodes, edges)
  assert.ok(issues.some((issue) => issue.edgeId === 'width' && issue.message.includes('width mismatch')))
  assert.ok(issues.some((issue) => issue.edgeId === 'duplicate' && issue.message.includes('multiple connections')))
  assert.ok(issues.some((issue) => issue.edgeId === 'missing' && issue.message.includes('valid ports')))
  assert.ok(issues.some((issue) => issue.nodeId === 'a' && issue.severity === 'warning' && issue.message.includes('unused')))
  assert.ok(!issues.some((issue) => issue.severity === 'warning' && issue.message.includes('.out')))
})

test('checks overlapping ranges per slave and handles legacy maps', () => {
  const ports = [port('s', 'input'), port('m1', 'output'), port('m2', 'output')]
  const entries = [{ portId: 'm1', baseAddress: '0x1000', size: '0x1000' }, { portId: 'm2', baseAddress: '0x1000', size: '0x1000' }]
  const grouped = node('bus', ports, { addressWidth: 32, groups: [{ slavePortId: 's', entries }] })
  const issues = validateDesign([grouped], [])
  assert.equal(issues.filter((issue) => issue.addressMap && issue.message.includes('overlaps')).length, 2)
  const legacy = node('bus', ports, { addressWidth: 32, entries: [{ portId: 'm1', baseAddress: '0x100000000', size: '0x1' }] })
  assert.ok(validateDesign([legacy], []).some((issue) => issue.addressMap && issue.message.includes('outside address range')))
  const separate = node('bus', ports, { addressWidth: 32, groups: [{ slavePortId: 's', entries: [entries[0]] }, { slavePortId: 'other', entries: [entries[1]] }] })
  assert.ok(!validateDesign([separate], []).some((issue) => issue.addressMap))
})
