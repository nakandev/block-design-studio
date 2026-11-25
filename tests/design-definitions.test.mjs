import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, helpers, loadDefinitionFolder, validateDefinitions
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  helpers = await server.ssrLoadModule('/src/designDefinitions.ts')
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
    file('interface/ahb.json', { version: '0.1.0', name: 'ahb', label: 'AHB' }),
    file('block/bus.json', { version: '0.1.0', kind: 'Bus', label: 'Bus', ports: [master] }),
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
