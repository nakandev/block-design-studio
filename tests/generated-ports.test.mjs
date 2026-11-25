import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, ports, Editor
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ports = await server.ssrLoadModule('/src/generatedPorts.ts')
  ;({ default: Editor } = await server.ssrLoadModule('/src/GeneratedPortsEditor.tsx'))
})
after(async () => { await server?.close() })

const definitions = [
  { id: 'clk', name: 'clk', direction: 'input', type: 'clock' },
  { id: 's{i}', name: 's{i}', direction: 'output', type: 'axi.master', generate: { for: { index: 'i', count: 2, min: 1, max: 4 }, if: { default: true } } },
  { id: 'debug', name: 'debug', direction: 'output', width: 1, generate: { if: { default: false } } },
]

test('validates generate and rejects collisions across all allowed counts', () => {
  assert.deepEqual(ports.validateGenerate(definitions[1].generate, 's{i}'), definitions[1].generate)
  assert.deepEqual(ports.validateGenerate({ if: { default: false } }, 'debug'), { if: { default: false } })
  assert.throws(() => ports.validateGenerate({ for: { index: 'i', count: 2, min: 1, max: 4 } }, 's'), /placeholder/)
  assert.throws(() => ports.validateGenerate({ for: { index: 'i', count: 5, min: 1, max: 4 } }, 's{i}'), /min/)
  assert.throws(() => ports.validateGenerate({ if: { defaultEnabled: true } }, 'x'), /boolean default/)
  assert.throws(() => ports.validateGenerate({ if: { default: true, condition: 'ENABLE' } }, 'x'), /boolean default/)
  assert.throws(() => ports.validatePortIds([...definitions, { id: 's3', name: 's3', direction: 'input', width: 1 }]), /Duplicate generated port id: s3/)
})

test('generates stable ids and independent enable state, including optional fixed ports', () => {
  const config = ports.initialPortConfiguration(definitions)
  const getIds = (counts, enabled) => ports.generatedPorts(config.portDefinitions, counts, enabled).map((port) => port.id)
  assert.deepEqual(getIds(config.portCounts, {}), ['clk', 's0', 's1'])
  assert.deepEqual(getIds({ 's{i}': 3 }, { s1: false, debug: true }), ['clk', 's0', 's2', 'debug'])
  assert.deepEqual(getIds({ 's{i}': 1 }, {}), ['clk', 's0'])
  assert.notEqual(config.portDefinitions[1].generate, definitions[1].generate)
  const restored = JSON.parse(JSON.stringify(config))
  assert.deepEqual(getIds(restored.portCounts, { s0: false }), ['clk', 's1'])
})

test('adopts definitions only when existing ports match without changing connections', () => {
  const config = ports.initialPortConfiguration(definitions)
  const data = { label: 'x', kind: 'x', parameters: {}, ports: ports.generatedPorts(config.portDefinitions, config.portCounts, config.portEnabled) }
  const adopted = ports.adoptPortDefinitions(data, definitions)
  assert.equal(adopted.ports, data.ports)
  assert.deepEqual(adopted.portCounts, { 's{i}': 2 })
  const incompatible = { ...data, ports: data.ports.slice(0, -1) }
  assert.equal(ports.adoptPortDefinitions(incompatible, definitions), incompatible)
  assert.equal(ports.adoptPortDefinitions(adopted, definitions), adopted)
})

test('removes only affected address-map entries and preserves legacy slave mappings', () => {
  const existingPorts = [
    { id: 'm0', name: 'm0', direction: 'input', type: 'axi.slave' },
    { id: 'm1', name: 'm1', direction: 'input', type: 'axi.slave' },
    { id: 's0', name: 's0', direction: 'output', type: 'axi.master' },
    { id: 's1', name: 's1', direction: 'output', type: 'axi.master' },
  ]
  const entries = [{ portId: 's0', baseAddress: '0x0', size: '0x100' }, { portId: 's1', baseAddress: '0x100', size: '0x100' }]
  const legacy = { addressWidth: 32, entries }
  const removed = new Set(['m0', 's1'])
  assert.deepEqual(ports.addressMapImpact(legacy, removed, existingPorts), ['m0 / s0', 'm0 / s1', 'm1 / s1'])
  assert.deepEqual(ports.removeAddressMapPorts(legacy, removed, existingPorts), { addressWidth: 32, groups: [{ slavePortId: 'm1', entries: [entries[0]] }] })
  const grouped = { addressWidth: 32, groups: [{ slavePortId: 'm0', entries }, { slavePortId: 'm1', entries }] }
  assert.deepEqual(ports.removeAddressMapPorts(grouped, removed, existingPorts), { addressWidth: 32, groups: [{ slavePortId: 'm1', entries: [entries[0]] }] })
  assert.equal(grouped.groups[0].entries.length, 2)
})

test('plans a port disable atomically without affecting unrelated edges or old state', () => {
  const config = ports.initialPortConfiguration(definitions)
  const data = {
    label: 'x', kind: 'x', parameters: {}, ...config,
    ports: ports.generatedPorts(config.portDefinitions, config.portCounts, config.portEnabled),
    addressMap: { addressWidth: 32, groups: [{ slavePortId: 'm0', entries: [{ portId: 's1', baseAddress: '0x0', size: '0x100' }, { portId: 's0', baseAddress: '0x100', size: '0x100' }] }] },
  }
  const edges = [
    { id: 'keep', source: 'block', sourceHandle: 's0', target: 'other', targetHandle: 'in' },
    { id: 'remove', source: 'block', sourceHandle: 's1', target: 'other', targetHandle: 'in2' },
    { id: 'other', source: 'different', sourceHandle: 's1', target: 'other', targetHandle: 'in3' },
  ]
  const plan = ports.planPortChange('block', data, edges, config.portCounts, { s1: false }, new Set(['s1']))
  assert.deepEqual(plan.data.ports.map((port) => port.id), ['clk', 's0'])
  assert.deepEqual(plan.edges.map((edge) => edge.id), ['keep', 'other'])
  assert.deepEqual(plan.disconnected.map((edge) => edge.id), ['remove'])
  assert.deepEqual(plan.mappings, ['m0 / s1'])
  assert.deepEqual(plan.data.addressMap.groups[0].entries.map((entry) => entry.portId), ['s0'])
  assert.equal(data.ports.length, 3)
  assert.equal(data.addressMap.groups[0].entries.length, 2)
  assert.equal(edges.length, 3)
  const restored = ports.planPortChange('block', plan.data, plan.edges, config.portCounts, { s1: true }, new Set())
  assert.deepEqual(restored.data.ports.map((port) => port.id), ['clk', 's0', 's1'])
  assert.deepEqual(restored.edges.map((edge) => edge.id), ['keep', 'other'])
})

test('editor exposes count and disabled ports even when absent from the canvas', () => {
  const config = ports.initialPortConfiguration(definitions)
  const data = { label: 'x', kind: 'x', parameters: {}, ...config, ports: ports.generatedPorts(config.portDefinitions, config.portCounts, config.portEnabled) }
  const html = renderToStaticMarkup(React.createElement(Editor, { data, onCountChange() {}, onEnabledChange() {} }))
  assert.match(html, /aria-label="s\{i\} count"/)
  assert.match(html, /aria-label="Enable port s0"[^>]*checked/)
  assert.match(html, /aria-label="Enable port debug"/)
  assert.doesNotMatch(html, /aria-label="Enable port debug"[^>]*checked/)
})
