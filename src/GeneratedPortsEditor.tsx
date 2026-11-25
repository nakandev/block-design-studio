import { useEffect, useState } from 'react'
import { expandDefinition } from './generatedPorts'
import type { BlockData, BlockPort } from './types'

function CountEditor({ definition, count, onChange }: { definition: BlockPort; count: number; onChange: (value: number) => void }) {
  const loop = definition.generate!.for!
  const [draft, setDraft] = useState(String(count))
  const [error, setError] = useState(false)
  useEffect(() => { setDraft(String(count)); setError(false) }, [count])
  const commit = () => {
    const value = Number(draft)
    if (!/^\d+$/.test(draft) || !Number.isSafeInteger(value) || value < loop.min || value > loop.max) { setError(true); return }
    setError(false)
    if (value !== count) onChange(value)
    setDraft(String(count))
  }
  return <label>{definition.name} count ({loop.min}–{loop.max})
    <input aria-label={`${definition.name} count`} type="number" min={loop.min} max={loop.max} step="1" value={draft} aria-invalid={error} onChange={(event) => { setDraft(event.target.value); setError(false) }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    {error && <span className="settings-error" role="alert">Enter an integer from {loop.min} to {loop.max}.</span>}
  </label>
}

export default function GeneratedPortsEditor({ data, onCountChange, onEnabledChange }: {
  data: BlockData
  onCountChange: (definition: BlockPort, count: number) => void
  onEnabledChange: (port: BlockPort, enabled: boolean) => void
}) {
  if (!data.portDefinitions) return null
  return <div className="property-section"><strong>Port configuration</strong>
    {data.portDefinitions.filter((definition) => definition.generate).map((definition) => {
      const count = data.config?.ports?.counts[definition.id] ?? definition.generate?.for?.count ?? 1
      return <div className="define-setting" key={definition.id}>
        {definition.generate?.for && <CountEditor definition={definition} count={count} onChange={(value) => onCountChange(definition, value)} />}
        {definition.generate?.if && expandDefinition(definition, count).map((port) => <label className="settings-checkbox" key={port.id}>
          <input type="checkbox" aria-label={`Enable port ${port.name}`} checked={data.config?.ports && Object.prototype.hasOwnProperty.call(data.config.ports.enabled, port.id) ? data.config.ports.enabled[port.id] : definition.generate!.if!.default} onChange={(event) => onEnabledChange(port, event.target.checked)} />{port.name}
        </label>)}
      </div>
    })}
  </div>
}
