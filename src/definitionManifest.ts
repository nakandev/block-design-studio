interface DefinitionFile {
  webkitRelativePath: string
  text(): Promise<string>
}

export interface Reference {
  path: string
  version: string
}

export interface DefinitionSources {
  interfaces: Reference[]
  blocks: Reference[]
}

function references(value: unknown, category: string): Reference[] {
  if (!Array.isArray(value)) throw new Error(`Manifest ${category} must be an array`)
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid ${category} reference ${index + 1}`)
    const ref = entry as Record<string, unknown>
    if (typeof ref.path !== 'string' || !ref.path.endsWith('.json') ||
      ref.path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\')) ||
      typeof ref.version !== 'string' || !ref.version.trim()) {
      throw new Error(`Invalid path or version in ${category} reference ${index + 1}`)
    }
    return { path: ref.path, version: ref.version }
  })
}

export async function loadDefinitionFolder(files: Iterable<DefinitionFile>) {
  const all = Array.from(files)
  const manifests = all.filter((file) => /^[^/]+\/block-definitions\.json$/.test(file.webkitRelativePath))
  if (manifests.length !== 1) throw new Error('Select a folder containing block-definitions.json at its root')
  const root = manifests[0].webkitRelativePath.split('/')[0]
  const byPath = new Map<string, DefinitionFile>()
  for (const file of all) {
    if (!file.webkitRelativePath.startsWith(`${root}/`)) throw new Error('Files must belong to the selected folder')
    const path = file.webkitRelativePath.slice(root.length + 1)
    if (byPath.has(path)) throw new Error(`Duplicate file: ${path}`)
    byPath.set(path, file)
  }
  const manifest: unknown = JSON.parse(await manifests[0].text())
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid definitions manifest')
  const raw = manifest as Record<string, unknown>
  const interfaces = references(raw.interfaces, 'interfaces')
  const blocks = references(raw.blocks, 'blocks')
  const seen = new Set<string>()
  const load = async (ref: Reference) => {
    if (seen.has(ref.path)) throw new Error(`Duplicate definition path: ${ref.path}`)
    seen.add(ref.path)
    const file = byPath.get(ref.path)
    if (!file) throw new Error(`Missing definition file: ${ref.path}`)
    let value: unknown
    try { value = JSON.parse(await file.text()) }
    catch (error) { throw new Error(`Could not read ${ref.path}: ${error instanceof Error ? error.message : String(error)}`) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid definition: ${ref.path}`)
    if ((value as Record<string, unknown>).version !== ref.version) throw new Error(`Version mismatch in ${ref.path}: expected ${ref.version}`)
    return value
  }
  return { interfaces: await Promise.all(interfaces.map(load)), blocks: await Promise.all(blocks.map(load)), sources: { interfaces, blocks } }
}
