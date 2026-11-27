import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, helpers, generated, loadDefinitionFolder, validateDefinitions
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  helpers = await server.ssrLoadModule('/src/designDefinitions.ts')
  generated = await server.ssrLoadModule('/src/generatedPorts.ts')
  ;({ loadDefinitionFolder } = await server.ssrLoadModule('/src/definitionManifest.ts'))
  ;({ validateDefinitions } = await server.ssrLoadModule('/src/App.tsx'))
})
after(async () => { await server?.close() })

const file = (path, value) => ({ webkitRelativePath: `defs/${path}`, text: async () => JSON.stringify(value) })
const ref = (path, version = '0.1.0') => ({ path, version })
const master = { id: 'm', name: 'm', direction: 'output', type: 'ahb.master' }

test('manifest reference paths and versions survive loading and validation', async () => {
  const manifest = { interfaces: [ref('interface/ahb.json')], blocks: [ref('block/bus.json')] }
  const folder = await loadDefinitionFolder([
    file('block-definitions.json', manifest),
    file('interface/ahb.json', { version: '0.1.0', name: 'ahb', type: 'AHB' }),
    file('block/bus.json', { version: '0.1.0', type: 'Bus', name: 'Bus', ports: [master] }),
  ])
  const parsed = validateDefinitions(folder, folder.sources)
  assert.deepEqual(parsed.interfaces[0].source, ref('interface/ahb.json'))
  assert.deepEqual(parsed.blocks[0].source, ref('block/bus.json'))
  assert.equal(validateDefinitions(folder).blocks[0].source, undefined)
})

test('export lists only used definitions, including disabled ports and external interfaces', () => {
  const interfaces = [{ name: 'ahb', source: ref('interface/ahb.json') }, { name: 'axi', source: ref('interface/axi.json') }, { name: 'unused', source: ref('interface/unused.json') }]
  const sources = helpers.captureInterfaceSources(helpers.usedInterfaces([master], { interface: 'axi' }), interfaces)
  const nodes = [
    { type: 'block', data: { kind: 'Bus', ports: [], portDefinitions: [master], bus: { interface: 'axi' }, definitionSource: ref('block/bus.json'), interfaceSources: sources } },
    { type: 'externalInterfaceMaster', data: { kind: 'external', ports: [master], interfaceSources: sources } },
    { type: 'block', data: { kind: 'Input', ports: [] } },
  ]
  const definitions = helpers.designDefinitions(nodes)
  assert.deepEqual(definitions, {
    blocks: [{ kind: 'Bus', ...ref('block/bus.json') }, { kind: 'Input', path: null, version: null }],
    interfaces: [{ name: 'ahb', ...ref('interface/ahb.json') }, { name: 'axi', ...ref('interface/axi.json') }],
  })
  assert.deepEqual(helpers.designDefinitions(JSON.parse(JSON.stringify(nodes))), definitions)
})

test('different versions and unknown sources stay distinct after reload', () => {
  const nodes = [
    { type: 'block', data: { kind: 'Bus', ports: [master], definitionSource: ref('block/bus.json', '0.1.0'), interfaceSources: { ahb: ref('interface/ahb.json', '0.1.0') } } },
    { type: 'block', data: { kind: 'Bus', ports: [master], definitionSource: ref('block/bus.json', '0.2.0'), interfaceSources: { ahb: ref('interface/ahb.json', '0.2.0') } } },
    { type: 'block', data: { kind: 'Bus', ports: [master] } },
  ]
  const result = helpers.designDefinitions(nodes)
  assert.deepEqual(result.blocks.map((entry) => entry.version), ['0.1.0', '0.2.0', null])
  assert.deepEqual(result.interfaces.map((entry) => entry.version), ['0.1.0', '0.2.0', null])
  assert.equal(helpers.canMergeDefinition(ref('block/bus.json'), ref('block/bus.json')), true)
  assert.equal(helpers.canMergeDefinition(ref('block/bus.json'), ref('block/bus.json', '0.2.0')), false)
  assert.equal(helpers.canMergeDefinition(ref('block/bus.json'), undefined), false)
  assert.equal(helpers.canMergeDefinition(undefined, ref('block/bus.json')), true)
})

test('migrates legacy sources per port and preserves explicit sources including unknown', () => {
  const legacy = { label: 'Bus', kind: 'Bus', parameters: {}, interfaceSources: { ahb: ref('interface/ahb.json') }, ports: [
    master,
    { ...master, id: 'm2', interfaceSource: ref('interface/ahb.json', '0.2.0') },
    { ...master, id: 'm3', interfaceSource: { path: null, version: null } },
    { id: 'clk', name: 'clk', direction: 'input', type: 'clock' },
  ], portDefinitions: [{ ...master, id: 'm{i}', generate: { for: { index: 'i', count: 1, min: 0, max: 2 } } }] }
  const migrated = helpers.migrateInterfaceSources(legacy)
  assert.deepEqual(migrated.ports.map((port) => port.interfaceSource), [ref('interface/ahb.json'), ref('interface/ahb.json', '0.2.0'), { path: null, version: null }, undefined])
  assert.deepEqual(migrated.portDefinitions[0].interfaceSource, ref('interface/ahb.json'))
  assert.equal(legacy.ports[0].interfaceSource, undefined)
  const nodes = [{ type: 'block', data: JSON.parse(JSON.stringify(migrated)) }]
  assert.deepEqual(helpers.designDefinitions(nodes).interfaces.map((entry) => entry.version), ['0.1.0', '0.2.0', null])
})

test('generated and external ports carry sources through changes and JSON round trips', () => {
  const source = ref('interface/ahb.json')
  const definition = { ...master, id: 'm{i}', name: 'm{i}', generate: { for: { index: 'i', count: 1, min: 0, max: 3 }, if: { default: true } } }
  const [sourced] = helpers.withInterfaceSources([definition], { ahb: source })
  const config = generated.initialPortConfiguration([sourced])
  const data = { label: 'Bus', kind: 'Bus', parameters: {}, ...config, ports: generated.generatedPorts(config.portDefinitions, config.config.ports.counts, config.config.ports.enabled) }
  data.ports[0].interfaceSource = ref('interface/ahb.json', '0.2.0')
  const updated = generated.planPortChange('bus', data, [], { 'm{i}': 2 }, {}, new Set()).data
  assert.deepEqual(updated.ports.map((port) => port.interfaceSource), [ref('interface/ahb.json', '0.2.0'), source])
  const disabled = generated.planPortChange('bus', updated, [], { 'm{i}': 2 }, { m0: false, m1: false }, new Set()).data
  assert.deepEqual(helpers.designDefinitions([{ type: 'block', data: disabled }]).interfaces, [{ name: 'ahb', ...source }])
  const restored = generated.planPortChange('bus', JSON.parse(JSON.stringify(disabled)), [], { 'm{i}': 2 }, { m0: true, m1: true }, new Set()).data
  assert.deepEqual(restored.ports.map((port) => port.interfaceSource), [ref('interface/ahb.json', '0.2.0'), source])
  const reduced = generated.planPortChange('bus', restored, [], { 'm{i}': 0 }, {}, new Set()).data
  const increased = generated.planPortChange('bus', reduced, [], { 'm{i}': 2 }, {}, new Set()).data
  assert.deepEqual(increased.ports.map((port) => port.interfaceSource), [ref('interface/ahb.json', '0.2.0'), source])
  const external = helpers.withInterfaceSources([master], { ahb: source })
  assert.deepEqual(JSON.parse(JSON.stringify(external))[0].interfaceSource, source)
  assert.deepEqual(helpers.withInterfaceSources([master])[0].interfaceSource, { path: null, version: null })
})

test('adopting generated definitions preserves legacy port provenance without guessing mixed versions', () => {
  const definition = { ...master, id: 'm{i}', name: 'm{i}', generate: { for: { index: 'i', count: 2, min: 0, max: 3 } } }
  const data = { label: 'Bus', kind: 'Bus', parameters: {}, ports: [
    { ...master, id: 'm0', name: 'm0', interfaceSource: ref('interface/ahb.json') },
    { ...master, id: 'm1', name: 'm1', interfaceSource: ref('interface/ahb.json', '0.2.0') },
  ] }
  const adopted = generated.adoptPortDefinitions(data, [definition])
  assert.deepEqual(adopted.portDefinitions[0].interfaceSource, { path: null, version: null })
  const updated = generated.planPortChange('bus', adopted, [], { 'm{i}': 3 }, {}, new Set()).data
  assert.deepEqual(updated.ports.map((port) => port.interfaceSource), [ref('interface/ahb.json'), ref('interface/ahb.json', '0.2.0'), { path: null, version: null }])
})
