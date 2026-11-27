import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

let server, loadDefinitionFolder, resolveDefinitionManifest, validateDefinitions, defaultTemplates, defaultInterfaces, interfaceSignals
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ loadDefinitionFolder, resolveDefinitionManifest } = await server.ssrLoadModule('/src/definitionManifest.ts'))
  ;({ validateDefinitions, defaultTemplates, defaultInterfaces } = await server.ssrLoadModule('/src/App.tsx'))
  ;({ interfaceSignals } = await server.ssrLoadModule('/src/interfaceSignals.ts'))
})
after(async () => { await server?.close() })

const file = (path, value) => ({ webkitRelativePath: `defs/${path}`, text: async () => JSON.stringify(value) })
const manifest = { interfaces: [{ path: 'interface/ahb.json', version: '0.1.0' }], blocks: [{ path: 'block/bus.json', version: '0.1.0' }] }
const iface = { version: '0.1.0', name: 'ahb', type: 'AHB' }
const block = { version: '0.1.0', type: 'Bus', name: 'Bus', bus: { interface: 'ahb' }, ports: [{ id: 'm', name: 'm', type: 'ahb.master' }] }
const files = () => [file('block-definitions.json', manifest), file('interface/ahb.json', iface), file('block/bus.json', block)]

test('resolves and validates versioned definitions', async () => {
  const parsed = validateDefinitions(await loadDefinitionFolder(files()))
  assert.equal(parsed.interfaces[0].name, 'ahb')
  assert.equal(parsed.blocks[0].bus.interface, 'ahb')
  assert.equal(parsed.blocks[0].ports[0].direction, 'output')
  assert.throws(() => validateDefinitions([block]), /must be an object/)
})

test('definition names use the new fields and reject obsolete aliases', () => {
  const modern = { interfaces: [{ name: 'ahb', type: 'AHB display' }], blocks: [{ type: 'Bus', name: 'bus_instance', ports: [{ id: 'm', name: 'm', type: 'ahb.master' }] }] }
  assert.equal(validateDefinitions(modern).interfaces[0].label, 'AHB display')
  assert.equal(validateDefinitions(modern).blocks[0].kind, 'Bus')
  assert.equal(validateDefinitions(modern).blocks[0].label, 'bus_instance')
  assert.throws(() => validateDefinitions({ ...modern, blocks: [{ kind: 'Bus', label: 'bus_instance', ports: [] }] }), /no longer supported/)
  assert.throws(() => validateDefinitions({ ...modern, blocks: [{ ...modern.blocks[0], kind: 'Bus' }] }), /no longer supported/)
  assert.throws(() => validateDefinitions({ ...modern, blocks: [{ ...modern.blocks[0], label: 'bus_instance' }] }), /no longer supported/)
  assert.throws(() => validateDefinitions({ ...modern, interfaces: [{ name: 'ahb', label: 'AHB display' }] }), /no longer supported/)
  assert.throws(() => validateDefinitions({ ...modern, interfaces: [{ ...modern.interfaces[0], label: 'AHB display' }] }), /no longer supported/)
  assert.throws(() => validateDefinitions({ ...modern, blocks: [{ ...modern.blocks[0], type: '' }] }), /valid type/)
  assert.throws(() => validateDefinitions({ ...modern, blocks: [{ type: 'Bus', ports: [] }] }), /valid name/)
})

test('reports missing files, bad versions, duplicate and unsafe references', async () => {
  await assert.rejects(loadDefinitionFolder(files().slice(0, 2)), /Missing definition file: block\/bus.json/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', manifest), file('interface/ahb.json', { ...iface, version: '0.2.0' }), file('block/bus.json', block)]), /Version mismatch in interface\/ahb.json/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', { interfaces: [manifest.interfaces[0], manifest.interfaces[0]], blocks: [] }), file('interface/ahb.json', iface)]), /Duplicate definition path/)
  await assert.rejects(loadDefinitionFolder([file('block-definitions.json', { interfaces: [{ path: '../ahb.json', version: '0.1.0' }], blocks: [] })]), /Invalid path/)
  await assert.rejects(loadDefinitionFolder([file('nested/block-definitions.json', manifest)]), /at its root/)
  assert.throws(() => resolveDefinitionManifest(manifest, {}), /Missing definition file: interface\/ahb.json/)
  assert.throws(() => resolveDefinitionManifest(manifest, { 'interface/ahb.json': { ...iface, version: 'wrong' } }), /Version mismatch/)
  assert.throws(() => resolveDefinitionManifest({ interfaces: [manifest.interfaces[0], manifest.interfaces[0]], blocks: [] }, {}), /Duplicate definition path/)
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
  const loaded = await loadDefinitionFolder(entries)
  const parsed = validateDefinitions(loaded, loaded.sources)
  assert.deepEqual(defaultTemplates, parsed.blocks)
  assert.deepEqual(defaultInterfaces, parsed.interfaces)
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
  const examples = Object.fromEntries(parsed.interfaces.map((entry) => [entry.name, entry]))
  const expected = {
    apb: ['PADDR', 'PSEL', 'PENABLE', 'PWRITE', 'PWDATA', 'PSTRB', 'PPROT', 'PRDATA', 'PREADY', 'PSLVERR'],
    bram: ['EN', 'WE', 'ADDR', 'DIN', 'DOUT'],
    gpio: ['GPIO'],
    i2c: ['SCL', 'SDA'],
    i3c: ['SCL', 'SDA'],
    jtag: ['TCK', 'TMS', 'TDI', 'TDO'],
    spi: ['SCLK', 'CS_N', 'MOSI', 'MISO'],
    uart: ['TX', 'RX'],
    wb: ['ADR', 'DAT_W', 'DAT_R', 'SEL', 'WE', 'CYC', 'STB', 'ACK'],
  }
  for (const [name, names] of Object.entries(expected)) {
    const master = interfaceSignals(examples[name], 'master')
    const slave = interfaceSignals(examples[name], 'slave')
    assert.deepEqual(master.map((signal) => signal.name), names)
    for (const [index, signal] of master.entries()) {
      assert.equal(slave[index].width, signal.width)
      assert.equal(slave[index].direction, signal.direction === 'inout' ? 'inout' : signal.direction === 'input' ? 'output' : 'input')
    }
  }
  assert.equal(get(examples.apb, 'master', 'PSTRB').width, 'DATA_WIDTH / 8')
  assert.equal(get(examples.wb, 'master', 'ACK').direction, 'input')
  assert.equal(get(examples.i2c, 'slave', 'SCL').direction, 'inout')
  assert.equal(get(examples.i3c, 'slave', 'SDA').direction, 'inout')
  assert.equal(get(examples.gpio, 'master', 'GPIO').width, 'DATA_WIDTH')
  assert.equal(get(examples.bram, 'master', 'DOUT').direction, 'input')
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
    { ...signal, direction: 'invalid' }, { ...signal, name: 'not valid' }, null,
  ]) {
    assert.throws(() => parse({ signals: [invalid] }), /Invalid signals signal/)
  }
  assert.throws(() => parse({ signals: {} }), /expected an array/)
  assert.throws(() => parse({ parameters: { WIDTH: { type: '', value: '32' } } }), /Invalid parameter/)
  assert.throws(() => parse({ signals: [signal, signal] }), /Duplicate signal/)
  assert.throws(() => parse({ signals: [signal], slaveSignals: [signal] }), /Duplicate signal/)
  assert.doesNotThrow(() => parse({ masterSignals: [signal], slaveSignals: [signal] }))
  const bidirectional = parse({ signals: [{ name: 'SDA', direction: 'inout', width: 1 }] })
  assert.equal(interfaceSignals(bidirectional, 'master')[0].direction, 'inout')
  assert.equal(interfaceSignals(bidirectional, 'slave')[0].direction, 'inout')
})
