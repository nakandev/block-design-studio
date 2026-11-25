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
  assert.deepEqual(config.config.ports, { counts: { 's{i}': 2 }, enabled: { s0: true, s1: true, debug: false } })
  assert.deepEqual(getIds(config.config.ports.counts, config.config.ports.enabled), ['clk', 's0', 's1'])
  assert.deepEqual(getIds({ 's{i}': 3 }, { s1: false, debug: true }), ['clk', 's0', 's2', 'debug'])
  assert.deepEqual(getIds({ 's{i}': 1 }, {}), ['clk', 's0'])
  assert.notEqual(config.portDefinitions[1].generate, definitions[1].generate)
  const restored = JSON.parse(JSON.stringify(config))
  assert.deepEqual(getIds(restored.config.ports.counts, { s0: false }), ['clk', 's1'])
})

test('adopts definitions only when existing ports match without changing connections', () => {
  const config = ports.initialPortConfiguration(definitions)
  const data = { label: 'x', kind: 'x', parameters: {}, ports: ports.generatedPorts(config.portDefinitions, config.config.ports.counts, config.config.ports.enabled) }
  const adopted = ports.adoptPortDefinitions(data, definitions)
  assert.equal(adopted.ports, data.ports)
  assert.deepEqual(adopted.config.ports, { counts: { 's{i}': 2 }, enabled: { s0: true, s1: true, debug: false } })
  const incompatible = { ...data, ports: data.ports.slice(0, -1) }
  assert.equal(ports.adoptPortDefinitions(incompatible, definitions), incompatible)
  assert.equal(ports.adoptPortDefinitions(adopted, definitions), adopted)
  const configured = { ...data, config: { other: true, ports: { counts: { 's{i}': 3 }, enabled: { s1: false } } }, ports: [data.ports[0], data.ports[1], { ...data.ports[2], id: 's2', name: 's2' }] }
  const adoptedConfigured = ports.adoptPortDefinitions(configured, definitions)
  assert.equal(adoptedConfigured.config.other, true)
  assert.deepEqual(adoptedConfigured.config.ports, { counts: { 's{i}': 3 }, enabled: { s0: true, s1: false, s2: true, debug: false } })
})

test('migrates legacy settings and materializes defaults without changing ports or unrelated config', () => {
  const legacy = {
    label: 'x', kind: 'x', parameters: {}, portDefinitions: definitions,
    ports: [{ id: 's0' }], portCounts: { 's{i}': 3 }, portEnabled: { s1: false },
    config: { other: { keep: true } },
  }
  const migrated = ports.migratePortConfiguration(legacy)
  assert.deepEqual(migrated.config, { other: { keep: true }, ports: {
    counts: { 's{i}': 3 }, enabled: { s0: true, s1: false, s2: true, debug: false },
  } })
  assert.equal(migrated.ports, legacy.ports)
  assert.equal('portCounts' in migrated, false)
  assert.equal('portEnabled' in migrated, false)
  const roundTrip = ports.migratePortConfiguration(JSON.parse(JSON.stringify(migrated)))
  assert.deepEqual(roundTrip, migrated)
  const changedDefaults = structuredClone(definitions)
  changedDefaults[1].generate.if.default = false
  changedDefaults[2].generate.if.default = true
  assert.deepEqual(ports.migratePortConfiguration({ ...roundTrip, portDefinitions: changedDefaults }).config.ports, migrated.config.ports)
})

test('prefers new config over legacy fields and rejects invalid stored values', () => {
  const data = {
    label: 'x', kind: 'x', parameters: {}, ports: [], portDefinitions: definitions,
    portCounts: { 's{i}': 1 }, portEnabled: { s0: false },
    config: { ports: { counts: { 's{i}': 2 }, enabled: { s0: true } } },
  }
  assert.deepEqual(ports.migratePortConfiguration(data).config.ports, {
    counts: { 's{i}': 2 }, enabled: { s0: true, s1: true, debug: false },
  })
  assert.throws(() => ports.migratePortConfiguration({ ...data, config: { ports: { counts: { 's{i}': 5 }, enabled: {} } } }), /Invalid count/)
  assert.throws(() => ports.migratePortConfiguration({ ...data, config: { ports: { counts: {}, enabled: { s0: 'false' } } } }), /Invalid enabled states/)
  assert.throws(() => ports.migratePortConfiguration({ ...data, portCounts: [] }), /Invalid legacy counts/)
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
    ports: ports.generatedPorts(config.portDefinitions, config.config.ports.counts, config.config.ports.enabled),
    addressMap: { addressWidth: 32, groups: [{ slavePortId: 'm0', entries: [{ portId: 's1', baseAddress: '0x0', size: '0x100' }, { portId: 's0', baseAddress: '0x100', size: '0x100' }] }] },
  }
  const edges = [
    { id: 'keep', source: 'block', sourceHandle: 's0', target: 'other', targetHandle: 'in' },
    { id: 'remove', source: 'block', sourceHandle: 's1', target: 'other', targetHandle: 'in2' },
    { id: 'other', source: 'different', sourceHandle: 's1', target: 'other', targetHandle: 'in3' },
  ]
  const plan = ports.planPortChange('block', data, edges, config.config.ports.counts, { ...config.config.ports.enabled, s1: false }, new Set(['s1']))
  assert.deepEqual(plan.data.ports.map((port) => port.id), ['clk', 's0'])
  assert.deepEqual(plan.data.config.ports.enabled, { s0: true, s1: false, debug: false })
  assert.deepEqual(plan.edges.map((edge) => edge.id), ['keep', 'other'])
  assert.deepEqual(plan.disconnected.map((edge) => edge.id), ['remove'])
  assert.deepEqual(plan.mappings, ['m0 / s1'])
  assert.deepEqual(plan.data.addressMap.groups[0].entries.map((entry) => entry.portId), ['s0'])
  assert.equal(data.ports.length, 3)
  assert.equal(data.addressMap.groups[0].entries.length, 2)
  assert.equal(edges.length, 3)
  const restored = ports.planPortChange('block', plan.data, plan.edges, config.config.ports.counts, { ...plan.data.config.ports.enabled, s1: true }, new Set())
  assert.deepEqual(restored.data.ports.map((port) => port.id), ['clk', 's0', 's1'])
  assert.deepEqual(restored.edges.map((edge) => edge.id), ['keep', 'other'])
  const grown = ports.planPortChange('block', restored.data, restored.edges, { 's{i}': 3 }, restored.data.config.ports.enabled, new Set())
  assert.equal(grown.data.config.ports.enabled.s2, true)
  assert.equal(grown.data.config.ports.counts['s{i}'], 3)
})

test('editor exposes count and disabled ports even when absent from the canvas', () => {
  const config = ports.initialPortConfiguration(definitions)
  const data = { label: 'x', kind: 'x', parameters: {}, ...config, ports: ports.generatedPorts(config.portDefinitions, config.config.ports.counts, config.config.ports.enabled) }
  const html = renderToStaticMarkup(React.createElement(Editor, { data, onCountChange() {}, onEnabledChange() {} }))
  assert.match(html, /aria-label="s\{i\} count"/)
  assert.match(html, /aria-label="Enable port s0"[^>]*checked/)
  assert.match(html, /aria-label="Enable port debug"/)
  assert.doesNotMatch(html, /aria-label="Enable port debug"[^>]*checked/)
})
