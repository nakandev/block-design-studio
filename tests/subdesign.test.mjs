import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, subdesignPorts, syncSubdesignPorts, readSubdesigns, SubdesignPreview
let changeGraph, restoreParentConnections, canInsertSubdesign, syncWorkspaceOnOpen, syncWorkspacePorts
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ subdesignPorts, syncSubdesignPorts, readSubdesigns } = await server.ssrLoadModule('/src/subdesign.ts'))
  ;({ SubdesignPreview } = await server.ssrLoadModule('/src/SubdesignNode.tsx'))
  ;({ changeGraph, restoreParentConnections, canInsertSubdesign, syncWorkspaceOnOpen, syncWorkspacePorts } = await server.ssrLoadModule('/src/workspace.ts'))
})

test('preview renders boundary nodes and connects the specified internal ports', () => {
  const input = external('boundary', 'output')
  const sink = block('sink', 'block', [
    { id: 'first', name: 'first', direction: 'input', width: 8 },
    { id: 'second', name: 'second', direction: 'input', width: 8 },
  ])
  sink.position = { x: 300, y: 0 }
  const markup = renderToStaticMarkup(React.createElement(SubdesignPreview, {
    design: { id: 'child', name: 'Child', nodes: [input, sink], edges: [
      { id: 'wire', source: 'boundary', sourceHandle: 'data', target: 'sink', targetHandle: 'second' },
    ] },
  }))
  assert.match(markup, /subdesign-preview-boundary/)
  assert.match(markup, />#1 boundary</)
  assert.doesNotMatch(markup, /External/)
  assert.match(markup, />second</)
  assert.match(markup, /x1="156" y1="59" x2="300" y2="77"/)
})

test('preview sizes itself to the design and caps large layouts without cropping', () => {
  const first = external('first', 'output')
  const last = external('last', 'input')
  last.position = { x: 2000, y: 1200 }
  const markup = renderToStaticMarkup(React.createElement(SubdesignPreview, {
    design: { id: 'large', name: 'Large', nodes: [first, last], edges: [] },
  }))
  const match = markup.match(/width="(\d+)" height="(\d+)" viewBox="([^"]+)"/)
  assert.ok(match)
  assert.ok(Number(match[1]) <= 820 && Number(match[2]) <= 520)
  const [x, y, width, height] = match[3].split(' ').map(Number)
  assert.ok(x < 0 && y < 0 && x + width > 2156 && y + height > 1268)
  assert.match(markup, />#2 last</)
})
after(async () => { await server?.close() })

const external = (id, direction, width = 8) => ({
  id, type: direction === 'output' ? 'externalInput' : 'externalOutput', position: { x: 0, y: 0 },
  data: { kind: 'External', label: id, parameters: {}, ports: [{ id: 'data', name: id, direction, width }] },
})
const block = (id, type, ports, subdesignId) => ({
  id, type, position: { x: 0, y: 0 }, data: { kind: 'block', label: id, parameters: {}, ports, subdesignId },
})

test('external nodes define stable parent port identities with reversed direction', () => {
  const nodes = [external('input', 'output'), external('output', 'input')]
  assert.deepEqual(subdesignPorts(nodes).map(({ id, direction }) => [id, direction]), [['input', 'input'], ['output', 'output']])
  nodes[0].data.label = 'renamed'
  assert.equal(subdesignPorts(nodes)[0].id, 'input')
  assert.equal(subdesignPorts(nodes)[0].name, 'renamed')
})

test('synchronization identifies incompatible parent edges in all instances without mutating original graphs', () => {
  const internal = [external('input', 'output', 8)]
  const child = block('child', 'subdesign', subdesignPorts(internal), 'shared')
  const src = block('source', 'block', [{ id: 'out', name: 'out', direction: 'output', width: 8 }])
  const edge = { id: 'wire', source: 'source', sourceHandle: 'out', target: 'child', targetHandle: 'input' }
  const graphs = { top: { nodes: [src, child], edges: [edge] }, second: { nodes: [src, child], edges: [edge] } }
  const changed = syncSubdesignPorts(graphs, 'shared', [external('input', 'output', 16)])
  assert.equal(changed.removed.length, 2)
  assert.equal(changed.graphs.top.edges.length, 0)
  assert.equal(graphs.top.edges.length, 1)
  assert.equal(syncSubdesignPorts(graphs, 'shared', internal).removed.length, 0)
  const renamed = [external('input', 'output', 8)]
  renamed[0].data.label = 'renamed'
  assert.equal(syncSubdesignPorts(graphs, 'shared', renamed).removed.length, 0)
  assert.equal(syncSubdesignPorts(graphs, 'shared', []).removed.length, 2)
})

test('reads nested subdesigns and rejects missing or cyclic references', () => {
  const a = { id: 'a', name: 'A', nodes: [block('child', 'subdesign', [], 'b')], edges: [] }
  const b = { id: 'b', name: 'B', nodes: [external('in', 'output')], edges: [] }
  assert.deepEqual(readSubdesigns(undefined), [])
  assert.equal(readSubdesigns([a, b]).length, 2)
  assert.throws(() => readSubdesigns([a]), /Missing subdesign/)
  assert.throws(() => readSubdesigns([a, { ...b, nodes: [block('child', 'subdesign', [], 'a')] }]), /Circular/)
  assert.throws(() => readSubdesigns([a, a]), /unique IDs/)
  assert.throws(() => readSubdesigns([{ ...b, nodes: [external('in', 'output'), external('in', 'output')] }]), /duplicate node/)
  assert.throws(() => readSubdesigns([{ ...b, nodes: [{ ...external('in', 'output'), position: {} }] }]), /Invalid node data/)
  assert.throws(() => readSubdesigns([{ ...b, nodes: [{ ...external('in', 'output'), data: { ...external('in', 'output').data, parameters: null } }] }]), /Invalid node data/)
  assert.throws(() => readSubdesigns([], [block('child', 'subdesign', [], 'missing')]), /Missing subdesign/)
  assert.throws(() => readSubdesigns(undefined, [block('child', 'subdesign', [], 'missing')]), /Missing subdesign/)
  assert.equal(readSubdesigns([a, b], [block('child', 'subdesign', [], 'a')]).length, 2)
})

test('workspace edits can restore removed parent edges without overwriting later edits', () => {
  const internal = [external('in', 'output')]
  const source = block('source', 'block', [{ id: 'out', name: 'out', direction: 'output', width: 8 }])
  const instance = block('instance', 'subdesign', subdesignPorts(internal), 'child')
  const wire = { id: 'wire', source: 'source', sourceHandle: 'out', target: 'instance', targetHandle: 'in' }
  const original = { root: { nodes: [source, instance], edges: [wire] }, subdesigns: [{ id: 'child', name: 'Child', nodes: internal, edges: [] }] }
  const removed = changeGraph(original, 'child', { nodes: [], edges: [] })
  assert.equal(removed.removed.length, 1)
  assert.equal(original.root.edges.length, 1)
  const undone = changeGraph(removed.workspace, 'child', { nodes: internal, edges: [] })
  const restored = restoreParentConnections(undone.workspace, removed.removed)
  assert.deepEqual(restored.root.edges, [wire])
  const occupied = { ...undone.workspace, root: { ...undone.workspace.root, edges: [{ ...wire, id: 'other' }] } }
  assert.throws(() => restoreParentConnections(occupied, removed.removed), /unavailable or incompatible/)
  assert.equal(occupied.root.edges[0].id, 'other')
  assert.throws(() => syncWorkspaceOnOpen({ ...original, subdesigns: [{ ...original.subdesigns[0], nodes: [] }] }), /inconsistent ports/)
})

test('subdesign insertion rejects cycles but permits reuse', () => {
  const workspace = { root: { nodes: [], edges: [] }, subdesigns: [
    { id: 'a', name: 'A', nodes: [block('child', 'subdesign', [], 'b')], edges: [] },
    { id: 'b', name: 'B', nodes: [], edges: [] },
  ] }
  assert.equal(canInsertSubdesign(workspace, '', 'a'), true)
  assert.equal(canInsertSubdesign(workspace, 'a', 'b'), true)
  assert.equal(canInsertSubdesign(workspace, 'b', 'a'), false)
  assert.equal(canInsertSubdesign(workspace, 'a', 'a'), false)
})

test('restoring an older parent snapshot synchronizes ports to the current child graph', () => {
  const child = { id: 'child', name: 'Child', nodes: [external('in', 'output')], edges: [] }
  const oldInstance = block('instance', 'subdesign', [], 'child')
  const workspace = { root: { nodes: [oldInstance], edges: [] }, subdesigns: [child] }
  const synced = syncWorkspacePorts(workspace)
  assert.deepEqual(synced.workspace.root.nodes[0].data.ports, subdesignPorts(child.nodes))
  assert.equal(oldInstance.data.ports.length, 0)
})

test('history metadata is not copied into persisted subdesigns', () => {
  const child = { id: 'child', name: 'Child', nodes: [], edges: [] }
  const workspace = { root: { nodes: [], edges: [] }, subdesigns: [child] }
  const updated = changeGraph(workspace, 'child', { nodes: [external('in', 'output')], edges: [], restore: [{ edge: { id: 'old' } }] }).workspace
  assert.equal('restore' in updated.subdesigns[0], false)
})
