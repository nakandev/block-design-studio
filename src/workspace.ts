import { connectionFor } from './connectionTools'
import { subdesignPorts, syncSubdesignPorts, type DesignGraph, type ParentConnectionImpact, type Subdesign } from './subdesign'

export const ROOT_GRAPH = ''

export interface Workspace {
  root: DesignGraph
  subdesigns: Subdesign[]
}

export function graphFor(workspace: Workspace, id: string): DesignGraph {
  if (id === ROOT_GRAPH) return workspace.root
  const design = workspace.subdesigns.find((item) => item.id === id)
  if (!design) throw new Error(`Missing subdesign: ${id}`)
  return design
}

function graphMap(workspace: Workspace): Record<string, DesignGraph> {
  return Object.fromEntries([[ROOT_GRAPH, workspace.root], ...workspace.subdesigns.map((design) => [design.id, design] as const)])
}

function withGraphs(workspace: Workspace, graphs: Record<string, DesignGraph>): Workspace {
  return {
    root: { nodes: graphs[ROOT_GRAPH].nodes, edges: graphs[ROOT_GRAPH].edges },
    subdesigns: workspace.subdesigns.map((design) => {
      const graph = graphs[design.id]
      return graph.nodes === design.nodes && graph.edges === design.edges ? design : { ...design, nodes: graph.nodes, edges: graph.edges }
    }),
  }
}

export function changeGraph(workspace: Workspace, id: string, graph: DesignGraph): { workspace: Workspace; removed: ParentConnectionImpact[] } {
  const previous = graphFor(workspace, id)
  const graphs = { ...graphMap(workspace), [id]: graph }
  if (id === ROOT_GRAPH || JSON.stringify(subdesignPorts(previous.nodes)) === JSON.stringify(subdesignPorts(graph.nodes))) {
    return { workspace: withGraphs(workspace, graphs), removed: [] }
  }
  const result = syncSubdesignPorts(graphs, id, graph.nodes)
  return { workspace: withGraphs(workspace, result.graphs), removed: result.removed }
}

export function restoreParentConnections(workspace: Workspace, impacts: ParentConnectionImpact[]): Workspace {
  const graphs = graphMap(workspace)
  for (const { graphId, edge } of impacts) {
    const graph = graphs[graphId]
    if (!graph) throw new Error(`Cannot restore connection ${edge.id}: parent design no longer exists`)
    const existing = graph.edges.find((item) => item.id === edge.id)
    if (existing) {
      if (existing.source !== edge.source || existing.target !== edge.target
        || existing.sourceHandle !== edge.sourceHandle || existing.targetHandle !== edge.targetHandle) {
        throw new Error(`Cannot restore connection ${edge.id}: its ID is already in use`)
      }
      continue
    }
    if (!edge.sourceHandle || !edge.targetHandle || !connectionFor(
      { nodeId: edge.source, portId: edge.sourceHandle },
      { nodeId: edge.target, portId: edge.targetHandle },
      graph.nodes,
      graph.edges,
    )) throw new Error(`Cannot restore connection ${edge.id}: its ports are unavailable or incompatible`)
    graphs[graphId] = { ...graph, edges: [...graph.edges, edge] }
  }
  return withGraphs(workspace, graphs)
}

export function canInsertSubdesign(workspace: Workspace, parentId: string, childId: string): boolean {
  if (!workspace.subdesigns.some((design) => design.id === childId)) return false
  const visited = new Set<string>()
  const reachesParent = (id: string): boolean => {
    if (id === parentId) return true
    if (visited.has(id)) return false
    visited.add(id)
    return graphFor(workspace, id).nodes.some((node) =>
      node.type === 'subdesign' && typeof node.data.subdesignId === 'string' && reachesParent(node.data.subdesignId))
  }
  return parentId === ROOT_GRAPH || !reachesParent(childId)
}

export function syncWorkspacePorts(workspace: Workspace): { workspace: Workspace; removed: ParentConnectionImpact[] } {
  let graphs = graphMap(workspace)
  const removed: ParentConnectionImpact[] = []
  for (const design of workspace.subdesigns) {
    const result = syncSubdesignPorts(graphs, design.id, design.nodes)
    removed.push(...result.removed)
    graphs = result.graphs
  }
  return { workspace: withGraphs(workspace, graphs), removed }
}

export function syncWorkspaceOnOpen(workspace: Workspace): Workspace {
  const result = syncWorkspacePorts(workspace)
  if (result.removed.length) throw new Error('Subdesigns have inconsistent ports affecting saved connections')
  return result.workspace
}

