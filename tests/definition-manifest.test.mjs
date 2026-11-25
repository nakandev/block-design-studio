import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

let server, loadDefinitionFolder, validateDefinitions
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ loadDefinitionFolder } = await server.ssrLoadModule('/src/definitionManifest.ts'))
  ;({ validateDefinitions } = await server.ssrLoadModule('/src/App.tsx'))
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
  const gpio = parsed.blocks.find((block) => block.kind === 'AXI_GPIO')
  assert.deepEqual(gpio.parameters, { WIDTH: { type: 'int', value: '32' } })
  assert.deepEqual(gpio.defines, { DEBUG: { enabled: true, value: '1' } })
})
