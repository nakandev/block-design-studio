import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, validateDesign, resolveWidth
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ validateDesign } = await server.ssrLoadModule('/src/designValidation.ts'))
  ;({ resolveWidth } = await server.ssrLoadModule('/src/widthExpression.ts'))
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

test('validates definitions, block names and conflicting defines without treating expressions as invalid', () => {
  const first = node('a', [])
  const second = node('b', [])
  first.data.label = 'same-name'
  second.data.label = 'same name'
  first.data.defines = { FOO: { enabled: true, value: '1' } }
  second.data.defines = { FOO: { enabled: true, value: '2' } }
  const issues = validateDesign([first, second], [], [], [])
  assert.ok(issues.some((issue) => issue.nodeId === 'b' && issue.message.includes('instance name') && issue.severity === 'warning'))
  assert.ok(issues.some((issue) => issue.message.includes('define FOO differs')))
  assert.ok(issues.some((issue) => issue.message.includes('block definition a is not loaded')))
  first.data.ports = [{ ...port('x', 'input'), name: 'data-in' }, { ...port('y', 'input'), name: 'data in' }]
  assert.ok(validateDesign([first], []).some((issue) => issue.message.includes('generated port name data_in collides')))
  second.data.label = ' '
  assert.ok(validateDesign([second], []).some((issue) => issue.severity === 'error' && issue.message.includes('name is empty')))
})

test('checks interface widths and drivers without rejecting inout or role-specific signals', () => {
  const source = node('source', [{ id: 'bus', name: 'bus', direction: 'output', type: 'bus.master' }])
  const sink = node('sink', [{ id: 'bus', name: 'bus', direction: 'input', type: 'bus.slave' }])
  const sink2 = node('sink2', sink.data.ports)
  source.data.parameters = { WIDTH: { type: 'int', value: 'BASE * 2' }, BASE: 4 }
  sink.data.parameters = { WIDTH: 16 }
  sink2.data.parameters = { WIDTH: 8 }
  const iface = { name: 'bus', label: 'Bus', signals: [
    { name: 'DATA', direction: 'output', width: 'WIDTH' },
    { name: 'READY', direction: 'input', width: 1 },
    { name: 'IO', direction: 'inout', width: 1 },
  ], masterSignals: [{ name: 'EXTRA', direction: 'input', width: 1 }] }
  const edges = [edge('one', 'source', 'bus', 'sink', 'bus'), edge('two', 'source', 'bus', 'sink2', 'bus')]
  let issues = validateDesign([source, sink, sink2], edges, undefined, [iface])
  assert.ok(issues.some((issue) => issue.edgeId === 'one' && issue.message.includes('DATA signal width mismatch (8 vs 16)')))
  assert.ok(issues.some((issue) => issue.edgeId === 'two' && issue.message.includes('READY has multiple drivers')))
  assert.ok(issues.some((issue) => issue.severity === 'warning' && issue.message.includes('role-specific')))
  assert.ok(!issues.some((issue) => issue.severity === 'error' && issue.message.includes('IO')))
  source.data.parameters.WIDTH.value = "8'hff"
  issues = validateDesign([source, sink], [edges[0]], undefined, [iface])
  assert.ok(issues.some((issue) => issue.severity === 'warning' && issue.message.includes('DATA width cannot be verified')))
  assert.ok(!issues.some((issue) => issue.message.includes('DATA signal width mismatch')))
})

test('reports incompatible interface directions and skips comparisons against mismatched definitions', () => {
  const source = node('source', [{ id: 'bus', name: 'bus', direction: 'output', type: 'bus.master', interfaceSource: { path: 'old', version: '1' } }])
  const sink = node('sink', [{ id: 'bus', name: 'bus', direction: 'input', type: 'bus.slave' }])
  const iface = { name: 'bus', label: 'Bus', source: { path: 'new', version: '2' }, masterSignals: [{ name: 'S', direction: 'input', width: 1 }], slaveSignals: [{ name: 'S', direction: 'input', width: 1 }] }
  const edges = [edge('wire', 'source', 'bus', 'sink', 'bus')]
  let issues = validateDesign([source, sink], edges, undefined, [iface])
  assert.ok(issues.some((issue) => issue.message.includes('interface definition source differs')))
  assert.ok(!issues.some((issue) => issue.message.includes('incompatible signal directions')))
  source.data.ports[0].interfaceSource = { path: 'new', version: '2' }
  issues = validateDesign([source, sink], edges, undefined, [iface])
  assert.ok(issues.some((issue) => issue.edgeId === 'wire' && issue.message.includes('incompatible signal directions')))
})

test('evaluates a safe width subset and leaves unsupported or cyclic expressions unknown', () => {
  const parameters = { A: { type: 'int', value: 'B + 2' }, B: 3, LOOP: 'LOOP' }
  assert.equal(resolveWidth('(A * 2) << 1', parameters), 20)
  assert.equal(resolveWidth('A + 2 * 3', parameters), 11)
  assert.equal(resolveWidth('1 / 2', parameters), undefined)
  assert.equal(resolveWidth('LOOP', parameters), undefined)
  assert.equal(resolveWidth("8'hff", parameters), undefined)
  assert.equal(resolveWidth('9007199254740991 + 1', parameters), undefined)
})
