import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let validateBlockSettings
let mergeBlockSettings
let BlockSettingsEditor

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ validateBlockSettings, mergeBlockSettings } = await server.ssrLoadModule('/src/blockSettings.ts'))
  ;({ default: BlockSettingsEditor } = await server.ssrLoadModule('/src/BlockSettingsEditor.tsx'))
})
after(async () => { await server?.close() })

test('validates HDL parameter types and unevaluated expressions', () => {
  const result = validateBlockSettings({
    parameters: { WIDTH: { type: 'int', value: '2**ADDR_WIDTH' }, MODE: { type: 'logic [7:0]', value: "8'hff" } },
    defines: { DEBUG: { enabled: false }, TARGET: { enabled: true, value: 'FPGA' } },
  }, 'CPU')
  assert.deepEqual(result, {
    parameters: { WIDTH: { type: 'int', value: '2**ADDR_WIDTH' }, MODE: { type: 'logic [7:0]', value: "8'hff" } },
    defines: { DEBUG: { enabled: false, value: '' }, TARGET: { enabled: true, value: 'FPGA' } },
  })
  assert.throws(() => validateBlockSettings({ parameters: { WIDTH: null } }, 'CPU'), /Invalid parameter WIDTH/)
  assert.throws(() => validateBlockSettings({ parameters: { WIDTH: { type: '', value: '1' } } }, 'CPU'), /Invalid parameter WIDTH/)
  assert.throws(() => validateBlockSettings({ parameters: { WIDTH: { type: 'int', value: 1 } } }, 'CPU'), /Invalid parameter WIDTH/)
  assert.throws(() => validateBlockSettings({ parameters: { WIDTH: { type: 'int' } } }, 'CPU'), /Invalid parameter WIDTH/)
  assert.throws(() => validateBlockSettings({ defines: { DEBUG: { enabled: true, value: 1 } } }, 'CPU'), /Invalid define DEBUG/)
  assert.throws(() => validateBlockSettings({ defines: [] }, 'CPU'), /must be an object/)
  assert.deepEqual(validateBlockSettings({}, 'CPU'), { parameters: {}, defines: {} })
})

test('merges missing defaults without changing existing values or sharing mutable defines', () => {
  const template = {
    kind: 'CPU', label: 'CPU', ports: [],
    parameters: { WIDTH: { type: 'int', value: '2**ADDR_WIDTH' }, ENABLED: { type: 'bit', value: "1'b1" } },
    defines: { DEBUG: { enabled: true, value: '' }, TARGET: { enabled: true, value: 'FPGA' } },
  }
  const data = { label: 'CPU', kind: 'CPU', ports: [], parameters: { WIDTH: 64 }, defines: { DEBUG: { enabled: false, value: 'old' } } }
  const merged = mergeBlockSettings(data, template)
  assert.deepEqual(merged.parameters, { WIDTH: { type: 'int', value: '64' }, ENABLED: { type: 'bit', value: "1'b1" } })
  assert.deepEqual(merged.defines, { DEBUG: { enabled: false, value: 'old' }, TARGET: { enabled: true, value: 'FPGA' } })
  assert.notEqual(merged.defines.TARGET, template.defines.TARGET)
  assert.equal(mergeBlockSettings(merged, template), merged)
  const restored = JSON.parse(JSON.stringify(merged))
  assert.deepEqual(mergeBlockSettings(restored, template), merged)
  const customized = { ...merged, parameters: { ...merged.parameters, WIDTH: { type: 'int unsigned', value: 'OTHER_WIDTH+1' } } }
  assert.equal(mergeBlockSettings(customized, template), customized)
  const legacy = { label: 'CPU', kind: 'CPU', ports: [], parameters: {} }
  const first = mergeBlockSettings(legacy, template)
  const second = mergeBlockSettings(legacy, template)
  first.parameters.WIDTH.value = 'changed'
  assert.equal(second.parameters.WIDTH.value, '2**ADDR_WIDTH')
  assert.equal(template.parameters.WIDTH.value, '2**ADDR_WIDTH')
  first.defines.TARGET.value = 'changed'
  assert.equal(second.defines.TARGET.value, 'FPGA')
  assert.equal(template.defines.TARGET.value, 'FPGA')
})

test('renders typed parameter controls and define enable/value controls', () => {
  const html = renderToStaticMarkup(React.createElement(BlockSettingsEditor, {
    data: {
      label: 'CPU', kind: 'CPU', ports: [],
      parameters: { WIDTH: { type: 'int', value: '2**ADDR_WIDTH' }, MODE: { type: 'logic [7:0]', value: "8'hff" }, SIGNED: true },
      defines: { DEBUG: { enabled: false, value: 'old' }, TARGET: { enabled: true, value: 'FPGA' } },
    },
    onParameterChange() {}, onDefineChange() {},
  }))
  assert.match(html, /WIDTH.*<small>int<\/small>/)
  assert.match(html, /MODE.*<small>logic \[7:0\]<\/small>/)
  assert.match(html, /aria-label="Parameter WIDTH"[^>]*value="2\*\*ADDR_WIDTH"/)
  assert.match(html, /aria-label="Parameter MODE"[^>]*value="8&#x27;hff"/)
  assert.match(html, /aria-label="Parameter SIGNED"[^>]*checked/)
  assert.match(html, /aria-label="Enable define DEBUG"/)
  assert.match(html, /aria-label="Define DEBUG value"[^>]*disabled[^>]*value="old"/)
  assert.match(html, /aria-label="Define TARGET value"[^>]*value="FPGA"/)
})
