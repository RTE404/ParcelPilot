'use client'
import { useState } from 'react'

export function ReasoningChainPanel({ steps }: { steps: { tool: string; summary: string }[] }) {
  const [expanded, setExpanded] = useState(false)
  if (steps.length === 0) return null
  return (
    <div className="mt-2 text-xs">
      <button onClick={() => setExpanded(e => !e)} className="text-blue-600 hover:underline">
        {expanded ? 'Hide reasoning' : 'Show reasoning'} ({steps.length} step{steps.length === 1 ? '' : 's'})
      </button>
      {expanded && (
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-gray-600">
          {steps.map((s, i) => (<li key={i}><span className="font-medium">{s.tool}:</span> {s.summary}</li>))}
        </ol>
      )}
    </div>
  )
}
