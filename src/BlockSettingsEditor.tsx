import { useEffect, useState } from 'react'
import type { BlockData, DefineValue, ParameterValue } from './types'

interface Props {
  data: BlockData
  onParameterChange: (name: string, value: ParameterValue) => void
  onDefineChange: (name: string, value: DefineValue) => void
}

function NumberParameter({ name, value, onChange }: { name: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState(false)

  useEffect(() => { setDraft(String(value)); setError(false) }, [value])

  const commit = () => {
    const number = Number(draft)
    if (!draft.trim() || !Number.isFinite(number)) { setError(true); return }
    setError(false)
    setDraft(String(number))
    if (number !== value) onChange(number)
  }

  return <label>{name}
    <input type="text" inputMode="decimal" aria-label={`Parameter ${name}`} aria-invalid={error} value={draft} onChange={(event) => { setDraft(event.target.value); setError(false) }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    {error && <span className="settings-error" role="alert">Enter a valid number. The previous value is retained until corrected.</span>}
  </label>
}

export default function BlockSettingsEditor({ data, onParameterChange, onDefineChange }: Props) {
  const parameters = Object.entries(data.parameters ?? {})
  const defines = Object.entries(data.defines ?? {})
  return <>
    {parameters.length > 0 && <div className="property-section"><strong>Parameters</strong>
      {parameters.map(([name, value]) => typeof value === 'object'
        ? <label key={name}>{name} <small>{value.type}</small><input aria-label={`Parameter ${name}`} value={value.value} onChange={(event) => onParameterChange(name, { ...value, value: event.target.value })} /></label>
        : typeof value === 'boolean'
        ? <label className="settings-checkbox" key={name}><input type="checkbox" aria-label={`Parameter ${name}`} checked={value} onChange={(event) => onParameterChange(name, event.target.checked)} />{name}</label>
        : typeof value === 'number'
          ? <NumberParameter key={name} name={name} value={value} onChange={(next) => onParameterChange(name, next)} />
          : <label key={name}>{name}<input aria-label={`Parameter ${name}`} value={value} onChange={(event) => onParameterChange(name, event.target.value)} /></label>)}
    </div>}
    {defines.length > 0 && <div className="property-section"><strong>Defines</strong>
      {defines.map(([name, define]) => <div className="define-setting" key={name}>
        <label className="settings-checkbox"><input type="checkbox" aria-label={`Enable define ${name}`} checked={define.enabled} onChange={(event) => onDefineChange(name, { ...define, enabled: event.target.checked })} />{name}</label>
        <label>Value<input aria-label={`Define ${name} value`} value={define.value} disabled={!define.enabled} placeholder="Optional" onChange={(event) => onDefineChange(name, { ...define, value: event.target.value })} /></label>
      </div>)}
    </div>}
  </>
}
