import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

let server, bus, generated, validateDefinitions, loadDefinitionFolder
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  bus = await server.ssrLoadModule('/src/bus.ts')
  generated = await server.ssrLoadModule('/src/generatedPorts.ts')
  ;({ validateDefinitions } = await server.ssrLoadModule('/src/App.tsx'))
  ;({ loadDefinitionFolder } = await server.ssrLoadModule('/src/definitionManifest.ts'))
})
after(async () => { await server?.close() })

const ports = [
  { id: 's0', name: 's0', direction: 'input', type: 'ahb.slave' },
  { id: 's1', name: 's1', direction: 'input', type: 'ahb.slave' },
  { id: 'm0', name: 'm0', direction: 'output', type: 'ahb.master' },
  { id: 'm1', name: 'm1', direction: 'output', type: 'ahb.master' },
  { id: 'other', name: 'other', direction: 'output', type: 'axi.master' },
]

test('validates bus interfaces and preserves legacy AXI designs', () => {
  const interfaces = new Set(['axi', 'ahb'])
  assert.deepEqual(bus.validateBus({ interface: 'ahb' }, interfaces, 'bus'), { interface: 'ahb' })
  assert.throws(() => bus.validateBus({ interface: 'missing' }, interfaces, 'bus'), /defined interface/)
  assert.throws(() => bus.validateBus({ interface: 'ahb', typo: true }, interfaces, 'bus'), /Invalid bus/)
  assert.equal(bus.validateBus(undefined, interfaces, 'CPU'), undefined)
  assert.deepEqual(bus.getBus({ kind: 'AXI Interconnect' }), { interface: 'axi' })
  assert.deepEqual(bus.getBus({ kind: 'AXI Interconnect', bus: { interface: 'ahb' } }), { interface: 'ahb' })
  assert.equal(bus.getBus({ kind: 'CPU' }), undefined)
})

test('loads example AHB bus definitions without altering interface port directions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../examples/block-definitions.json', import.meta.url), 'utf8'))
  const files = [{ webkitRelativePath: 'examples/block-definitions.json', text: async () => JSON.stringify(manifest) }]
  for (const ref of [...manifest.interfaces, ...manifest.blocks]) {
    files.push({ webkitRelativePath: `examples/${ref.path}`, text: () => readFile(new URL(`../examples/${ref.path}`, import.meta.url), 'utf8') })
  }
  const file = await loadDefinitionFolder(files)
  const { blocks } = validateDefinitions(file)
  const ahb = blocks.find((block) => block.kind === 'AHB Interconnect')
  assert.deepEqual(ahb.bus, { interface: 'ahb' })
  assert.deepEqual(bus.busPorts(ahb.ports, ahb.bus).slaves.map((port) => port.id), ['s0', 's1'])
  assert.equal(bus.createAddressMap(ahb.ports, ahb.bus).groups[0].entries.length, 8)
  file.blocks.find((block) => block.kind === 'AHB Interconnect').bus.interface = 'unknown'
  assert.throws(() => validateDefinitions(file), /defined interface/)
})

test('creates per-slave maps for the selected interface only', () => {
  const ahb = { interface: 'ahb' }
  assert.deepEqual(bus.busPorts(ports, ahb).masters.map((port) => port.id), ['m0', 'm1'])
  const map = bus.createAddressMap(ports, ahb)
  assert.deepEqual(map.groups.map((group) => group.slavePortId), ['s0', 's1'])
  assert.deepEqual(map.groups[0].entries.map((entry) => entry.portId), ['m0', 'm1'])
  assert.equal(map.groups[0].entries[0].baseAddress, null)
  assert.notEqual(map.groups[0].entries[0], map.groups[1].entries[0])
})

test('generated AHB port removal cleans only affected map entries and connections', () => {
  const definitions = [
    { id: 's{i}', name: 's{i}', direction: 'input', type: 'ahb.slave', generate: { for: { index: 'i', count: 2, min: 1, max: 4 } } },
    { id: 'm{i}', name: 'm{i}', direction: 'output', type: 'ahb.master', generate: { for: { index: 'i', count: 2, min: 1, max: 4 } } },
  ]
  const config = generated.initialPortConfiguration(definitions)
  const addressMap = { addressWidth: 32, entries: [{ portId: 'm0', baseAddress: '0x0', size: '0x100' }, { portId: 'm1', baseAddress: '0x100', size: '0x100' }] }
  const data = { label: 'bus', kind: 'custom', parameters: {}, bus: { interface: 'ahb' }, ports: ports.slice(0, 4), ...config, addressMap }
  const edges = [{ id: 'a', source: 'other', sourceHandle: 'out', target: 'bus', targetHandle: 's1' }, { id: 'b', source: 'bus', sourceHandle: 'm0', target: 'other', targetHandle: 'in' }]
  const plan = generated.planPortChange('bus', data, edges, { 's{i}': 1, 'm{i}': 2 }, {}, new Set(['s1']))
  assert.deepEqual(plan.mappings, ['s1 / m0', 's1 / m1'])
  assert.deepEqual(plan.edges.map((edge) => edge.id), ['b'])
  assert.deepEqual(plan.data.addressMap, { addressWidth: 32, groups: [{ slavePortId: 's0', entries: addressMap.entries }] })
  assert.equal(data.addressMap, addressMap)
})
