import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { Position, ReactFlow } from '@xyflow/react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, routePositionedEdge, BlockNodeView
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  ;({ routePositionedEdge } = await server.ssrLoadModule('/src/OrthogonalEdge.tsx'))
  ;({ default: BlockNodeView } = await server.ssrLoadModule('/src/BlockNode.tsx'))
})
after(async () => { await server?.close() })

function assertOrthogonal(points) {
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i - 1].x === points[i].x || points[i - 1].y === points[i].y)
  }
}

test('block ports render vertically by default and horizontally when selected', () => {
  const data = {
    label: 'Block', kind: 'Block', parameters: {}, ports: [
      { id: 'a', name: 'a', direction: 'input', width: 1 },
      { id: 'b', name: 'b', direction: 'output', type: 'clock' },
    ],
  }
  const render = (nodeData) => renderToStaticMarkup(React.createElement(ReactFlow, {
    nodes: [{ id: 'block', type: 'block', position: { x: 0, y: 0 }, data: nodeData, width: 196, height: 96 }],
    edges: [], nodeTypes: { block: BlockNodeView }, width: 800, height: 600,
  }))
  const vertical = render(data)
  assert.match(vertical, /react-flow__handle-left/)
  assert.match(vertical, /react-flow__handle-right/)
  const horizontal = render({ ...data, portLayout: 'horizontal' })
  assert.match(horizontal, /horizontal-ports/)
  assert.match(horizontal, /react-flow__handle-top/)
  assert.match(horizontal, /react-flow__handle-bottom/)
  assert.match(horizontal, /data-handleid="a"/)
  assert.match(horizontal, /data-handleid="b"/)
  assert.ok(horizontal.indexOf('data-handleid="a"') < horizontal.indexOf('block-node-header'))
  assert.ok(horizontal.indexOf('block-node-header') < horizontal.indexOf('data-handleid="b"'))
})

test('routes from bottom to top without crossing either node or an intervening obstacle', () => {
  const obstacles = [
    { left: -2, right: 102, top: -2, bottom: 102 },
    { left: -2, right: 102, top: 298, bottom: 402 },
    { left: 20, right: 80, top: 170, bottom: 230 },
  ]
  const path = routePositionedEdge({ x: 50, y: 100 }, { x: 50, y: 300 }, Position.Bottom, Position.Top, obstacles, 50)
  assertOrthogonal(path)
  assert.deepEqual(path[0], { x: 50, y: 100 })
  assert.equal(path[1].x, 50)
  assert.ok(path[1].y > 100)
  assert.equal(path.at(-2).x, 50)
  assert.ok(path.at(-2).y < 300)
  for (let i = 2; i < path.length - 1; i++) {
    const [a, b] = [path[i - 1], path[i]]
    for (const obstacle of obstacles) {
      if (a.x === b.x && obstacle.left < a.x && a.x < obstacle.right) {
        assert.ok(Math.max(a.y, b.y) <= obstacle.top || Math.min(a.y, b.y) >= obstacle.bottom)
      }
      if (a.y === b.y && obstacle.top < a.y && a.y < obstacle.bottom) {
        assert.ok(Math.max(a.x, b.x) <= obstacle.left || Math.min(a.x, b.x) >= obstacle.right)
      }
    }
  }
})

test('routes a mixed left-to-right and top-to-bottom layout', () => {
  const path = routePositionedEdge({ x: 100, y: 50 }, { x: 300, y: 200 }, Position.Right, Position.Top, [
    { left: -2, right: 102, top: -2, bottom: 102 },
    { left: 248, right: 352, top: 198, bottom: 302 },
  ], 200)
  assertOrthogonal(path)
  assert.equal(path[1].y, 50)
  assert.ok(path[1].x > 100)
  assert.equal(path.at(-2).x, 300)
  assert.ok(path.at(-2).y < 200)
})

test('routes around nodes when the target is above the source', () => {
  const path = routePositionedEdge({ x: 50, y: 400 }, { x: 50, y: 0 }, Position.Bottom, Position.Top, [
    { left: -2, right: 102, top: 298, bottom: 402 },
    { left: -2, right: 102, top: -2, bottom: 102 },
  ], 50)
  assertOrthogonal(path)
  assert.ok(path[1].y > 400)
  assert.ok(path.at(-2).y < 0)
})
