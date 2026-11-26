import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, designFingerprint, workspaceFingerprint
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ designFingerprint, workspaceFingerprint } = await server.ssrLoadModule('/src/designChanges.ts'))
})

test('workspace fingerprint includes each subdesign but ignores transient graph state', () => {
  const node = { id: 'a', type: 'block', position: { x: 1, y: 2 }, data: { label: 'A', ports: [], parameters: {} } }
  const child = { id: 'child', name: 'Child', nodes: [node], edges: [] }
  const saved = workspaceFingerprint('design', [], [], [child])
  assert.equal(workspaceFingerprint('design', [], [], [{ ...child, nodes: [{ ...node, selected: true }] }]), saved)
  assert.notEqual(workspaceFingerprint('design', [], [], []), saved)
  assert.notEqual(workspaceFingerprint('design', [], [], [{ ...child, name: 'Renamed' }]), saved)
  assert.notEqual(workspaceFingerprint('design', [], [], [{ ...child, nodes: [{ ...node, position: { x: 2, y: 2 } }] }]), saved)
})
after(async () => { await server?.close() })

test('only persistent design changes affect the saved fingerprint', () => {
  const nodes = [{ id: 'a', type: 'block', position: { x: 1, y: 2 }, data: { label: 'A', ports: [], parameters: {} } }]
  const edges = [{ id: 'e', source: 'a', target: 'b' }]
  const saved = designFingerprint('design', nodes, edges)
  assert.equal(designFingerprint('design', [{ ...nodes[0], selected: true, dragging: true, resizing: true, measured: { width: 100, height: 50 } }], [{ ...edges[0], selected: true }]), saved)
  assert.notEqual(designFingerprint('renamed', nodes, edges), saved)
  assert.notEqual(designFingerprint('design', [{ ...nodes[0], position: { x: 2, y: 2 } }], edges), saved)
  assert.notEqual(designFingerprint('design', [{ ...nodes[0], data: { ...nodes[0].data, label: 'B' } }], edges), saved)
  assert.notEqual(designFingerprint('design', nodes, []), saved)
  assert.equal(designFingerprint('design', nodes, edges), saved)
})
