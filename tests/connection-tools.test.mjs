import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, connectionFor, connectionCandidates, externalNodeFor
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ connectionFor, connectionCandidates, externalNodeFor } = await server.ssrLoadModule('/src/connectionTools.ts'))
})
after(async () => { await server?.close() })
const node = (id, ports, type = 'block') => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, kind: id, ports, parameters: {} } })
const port = (id, direction, width = 8) => ({ id, name: id, direction, width })
const ref = (nodeId, portId) => ({ nodeId, portId })

test('candidates respect direction, width, same-node exclusion and occupied inputs in either direction', () => {
  const a = node('a', [port('out', 'output'), port('own', 'input')])
  const b = node('b', [port('in', 'input'), port('wrong', 'input', 16)])
  const c = node('c', [port('other', 'output')])
  const nodes = [a, b, c]
  assert.deepEqual(connectionCandidates(ref('a', 'out'), nodes, []).map((item) => item.port.id), ['in'])
  assert.deepEqual(connectionCandidates(ref('b', 'in'), nodes, []).map((item) => item.port.id), ['out', 'other'])
  const connection = connectionFor(ref('b', 'in'), ref('a', 'out'), nodes, [])
  assert.deepEqual(connection, { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' })
  const edges = [{ id: 'existing', ...connection }]
  assert.equal(connectionFor(ref('b', 'in'), ref('c', 'other'), nodes, edges), null)
  assert.equal(connectionFor(ref('a', 'out'), ref('b', 'in'), nodes, edges), null)
  assert.ok(connectionFor(ref('a', 'out'), ref('a', 'own'), nodes, []) === null)
})

test('external port matches scalar, clocks and interfaces including provenance and unique names', () => {
  for (const p of [port('data', 'input', 32), { id: 'clk', name: 'clk', direction: 'input', type: 'clock' }, { id: 'bus', name: 'bus', direction: 'output', type: 'axi.master', interfaceSource: { path: 'axi.json', version: '1' } }]) {
    const block = node('block', [p])
    const ext = externalNodeFor(block, p, [block], 'external')
    assert.ok(connectionFor(ref(block.id, p.id), ref(ext.id, 'port'), [block, ext], []))
    if (p.width) assert.equal(ext.data.ports[0].width, p.width)
    if (p.interfaceSource) assert.deepEqual(ext.data.ports[0].interfaceSource, p.interfaceSource)
    const next = externalNodeFor(block, p, [block, ext], 'external2')
    assert.notEqual(ext.data.label, next.data.label)
    assert.notDeepEqual(ext.position, next.position)
  }
  const extMaster = node('external', [{ id: 'bus', name: 'bus', direction: 'input', type: 'axi.master' }], 'externalInterfaceMaster')
  const extSlave = externalNodeFor(extMaster, extMaster.data.ports[0], [extMaster], 'external2')
  assert.equal(extSlave.data.ports[0].type, 'axi.slave')
  assert.ok(connectionFor(ref('external', 'bus'), ref('external2', 'port'), [extMaster, extSlave], []))
})
