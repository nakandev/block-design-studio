import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, designFingerprint
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ designFingerprint } = await server.ssrLoadModule('/src/designChanges.ts'))
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
