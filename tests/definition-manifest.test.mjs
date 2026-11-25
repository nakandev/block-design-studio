import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

let server, loadDefinitionFolder, validateDefinitions, interfaceSignals
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ loadDefinitionFolder } = await server.ssrLoadModule('/src/definitionManifest.ts'))
  ;({ validateDefinitions } = await server.ssrLoadModule('/src/App.tsx'))
  ;({ interfaceSignals } = await server.ssrLoadModule('/src/interfaceSignals.ts'))
})
after(async () => { await server?.close() })

const file = (path, value) => ({ webkitRelativePath: `defs/${path}`, text: async () => JSON.stringify(value) })
const manifest = { interfaces: [{ path: 'interface/ahb.json', version: '0.1.0' }], blocks: [{ path: 'block/bus.json', version: '0.1.0' }] }
const iface = { version: '0.1.0', name: 'ahb', label: 'AHB' }
const block = { version: '0.1.0', kind: 'Bus', label: 'Bus', bus: { interface: 'ahb' }, ports: [{ id: 'm', name: 'm', type: 'ahb.master' }] }
const files = () => [file('block-definitions.json', manifest), file('interface/ahb.json', iface), file('block/bus.json', block)]

test('resolves and validates versioned definitions and preserves old formats', async () => {
  const parsed = validateDefinitions(await loadDefinitionFolder(files()))
  assert.equal(parsed.interfaces[0].name, 'ahb')
  assert.equal(parsed.blocks[0].bus.interface, 'ahb')
  assert.equal(parsed.blocks[0].ports[0].direction, 'output')
  assert.equal(validateDefinitions([block]).blocks[0].kind, 'Bus')
  assert.equal(validateDefinitions({ interfaces: [iface], blocks: [block] }).blocks[0].kind, 'Bus')
})

test('reports missing files, bad versions, duplicate and unsafe references', async () => {
  await assert.rejects(loadDefinitionFolder(files().slice(0, 2)), /Missing definition file: block\/bus.json/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', manifest), file('interface/ahb.json', { ...iface, version: '0.2.0' }), file('block/bus.json', block)]), /Version mismatch in interface\/ahb.json/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', { interfaces: [manifest.interfaces[0], manifest.interfaces[0]], blocks: [] }), file('interface/ahb.json', iface)]), /Duplicate definition path/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', { interfaces: [{ path: '../ahb.json', version: '0.1.0' }], blocks: [] })]), /Invalid path/)
  await assert.rejects(loadDefinitionFolder([file('nested/block-definitions.json', manifest)]), /at its root/)
})

test('all example references resolve and preserve the AXI GPIO settings', async () => {
  const root = new URL('../examples/', import.meta.url)
  const manifestText = await readFile(new URL('block-definitions.json', root), 'utf8')
  const definitionManifest = JSON.parse(manifestText)
  const entries = [
    { webkitRelativePath: 'examples/block-definitions.json', text: async () => manifestText },
    ...[...definitionManifest.interfaces, ...definitionManifest.blocks].map((ref) => ({
      webkitRelativePath: `examples/${ref.path}`, text: () => readFile(new URL(ref.path, root), 'utf8'),
    })),
  ]
  const parsed = validateDefinitions(await loadDefinitionFolder(entries))
  assert.equal(parsed.interfaces.length, 11)
  assert.equal(parsed.blocks.length, 13)
  const ahb = parsed.interfaces.find((entry) => entry.name === 'ahb')
  const axi = parsed.interfaces.find((entry) => entry.name === 'axi')
  const get = (definition, side, name) => interfaceSignals(definition, side).find((signal) => signal.name === name)
  assert.deepEqual(get(ahb, 'master', 'HADDR'), { name: 'HADDR', direction: 'output', width: 32 })
  assert.deepEqual(get(ahb, 'slave', 'HADDR'), { name: 'HADDR', direction: 'input', width: 32 })
  assert.equal(get(ahb, 'master', 'HREADY').direction, 'input')
  assert.equal(get(ahb, 'slave', 'HREADY').direction, 'input')
  assert.equal(get(ahb, 'slave', 'HREADYOUT').direction, 'output')
  assert.equal(get(ahb, 'slave', 'HSEL').direction, 'input')
  assert.equal(get(ahb, 'master', 'HSEL'), undefined)
  assert.deepEqual(get(axi, 'master', 'WSTRB'), { name: 'WSTRB', direction: 'output', width: 'DATA_WIDTH / 8' })
  assert.equal(get(axi, 'slave', 'WSTRB').direction, 'input')
  assert.equal(get(axi, 'slave', 'RVALID').direction, 'output')
  assert.equal(axi.parameters.DATA_WIDTH.value, '32')
  assert.equal(interfaceSignals(axi, 'master').length, 19)
  const gpio = parsed.blocks.find((block) => block.kind === 'AXI_GPIO')
  assert.deepEqual(gpio.parameters, { WIDTH: { type: 'int', value: '32' } })
  assert.deepEqual(gpio.defines, { DEBUG: { enabled: true, value: '1' } })
})

test('validates signal lists and retains legacy interfaces', () => {
  const parse = (item) => validateDefinitions({ interfaces: [{ name: 'test', ...item }], blocks: [] }).interfaces[0]
  assert.deepEqual(parse({}), { name: 'test', label: 'TEST' })
  const signal = { name: 'DATA', direction: 'output', width: 'WIDTH + 1' }
  assert.deepEqual(parse({ signals: [signal] }).signals, [signal])
  for (const invalid of [
    { ...signal, width: 0 }, { ...signal, width: 1.5 }, { ...signal, width: ' ' },
    { ...signal, direction: 'inout' }, { ...signal, name: 'not valid' }, null,
  ]) {
    assert.throws(() => parse({ signals: [invalid] }), /Invalid signals signal/)
  }
  assert.throws(() => parse({ signals: {} }), /expected an array/)
  assert.throws(() => parse({ parameters: { WIDTH: { type: '', value: '32' } } }), /Invalid parameter/)
  assert.throws(() => parse({ signals: [signal, signal] }), /Duplicate signal/)
  assert.throws(() => parse({ signals: [signal], slaveSignals: [signal] }), /Duplicate signal/)
  assert.doesNotThrow(() => parse({ masterSignals: [signal], slaveSignals: [signal] }))
})
