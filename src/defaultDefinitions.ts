/// <reference types="vite/client" />

import manifest from '../examples/block-definitions.json'
import { resolveDefinitionManifest } from './definitionManifest'

const bundledFiles = import.meta.glob<unknown>('../examples/{block,interface}/*.json', { eager: true, import: 'default' })
const files = Object.fromEntries(Object.entries(bundledFiles).map(([path, value]) => [path.slice('../examples/'.length), value]))

export const defaultDefinitions = resolveDefinitionManifest(manifest, files)
