'use client'
import { useChat, Chat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, isToolUIPart } from 'ai'
import { useMemo, useState } from 'react'
import { ToolActivityIndicator } from './ToolActivityIndicator'
import { ReasoningChainPanel } from './ReasoningChainPanel'

const TOOL_PART_PREFIX = 'tool-'

// I7: design spec §5.4 confidence badge — colors chosen to read as a status pill consistent with
// this file's existing amber approval-card / green-check tool-activity-row styling.
const CONFIDENCE_BADGE_STYLES: Record<string, string> = {
  High: 'border-green-300 bg-green-50 text-green-700',
  'Resolved conflict': 'border-blue-300 bg-blue-50 text-blue-700',
  Low: 'border-amber-300 bg-amber-50 text-amber-700',
  Escalated: 'border-red-300 bg-red-50 text-red-700',
}

export function ChatWindow({ apiEndpoint }: { apiEndpoint: string }) {
  const [input, setInput] = useState('')
  // Construct our own `Chat` instance (memoized so it's stable across renders and
  // the transport isn't recreated on every render) and pass it to `useChat({ chat })`
  // for reactivity. `chat.addToolApprovalResponse` is then called directly on this
  // instance to resolve pending confirmations.
  const chat = useMemo(() => new Chat({
    transport: new DefaultChatTransport({ api: apiEndpoint }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  }), [apiEndpoint])
  const { messages, sendMessage } = useChat({ chat })

  return (
    <div className="mx-auto flex h-[calc(100vh-48px)] max-w-2xl flex-col p-4">
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map(message => {
          const toolSteps = message.parts
            .filter(p => isToolUIPart(p))
            .filter(p => p.state === 'output-available')
            .map(p => ({ tool: p.type.replace(TOOL_PART_PREFIX, ''), summary: JSON.stringify(p.output).slice(0, 120) }))

          return (
            <div key={message.id} className={message.role === 'user' ? 'text-right' : ''}>
              {message.parts.map((part, i) => {
                if (part.type === 'text') return <p key={i} className="inline-block rounded-lg bg-white px-3 py-2 shadow-sm">{part.text}</p>

                // I7: design spec §5.4 confidence badge, written by runSelfCheckStream alongside
                // (not instead of) the text for every direct answer, including escalated turns.
                if (part.type === 'data-confidence') {
                  const label = String((part.data as { label?: string } | undefined)?.label ?? '')
                  const badgeStyle = CONFIDENCE_BADGE_STYLES[label] ?? 'border-gray-300 bg-gray-50 text-gray-700'
                  return (
                    <span key={i} className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${badgeStyle}`}>
                      {label}
                    </span>
                  )
                }

                if (!isToolUIPart(part)) return null
                const toolName = part.type.replace(TOOL_PART_PREFIX, '')

                if (part.state === 'approval-requested') {
                  return (
                    <div key={i} className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                      <p className="mb-2 font-medium">Confirm action: {toolName}</p>
                      <pre className="mb-2 whitespace-pre-wrap text-xs text-gray-600">{JSON.stringify(part.input, null, 2)}</pre>
                      <div className="flex gap-2">
                        <button onClick={() => chat.addToolApprovalResponse({ id: part.approval.id, approved: true })} className="rounded bg-green-600 px-3 py-1 text-white">Confirm</button>
                        <button onClick={() => chat.addToolApprovalResponse({ id: part.approval.id, approved: false })} className="rounded bg-gray-300 px-3 py-1">Cancel</button>
                      </div>
                    </div>
                  )
                }

                // The user has just clicked Confirm/Cancel; the response is queued locally
                // but not yet sent back to the server. Show it as "in progress" rather than
                // letting it disappear from the UI until the automatic resend completes.
                if (part.state === 'approval-responded') {
                  return <ToolActivityIndicator key={i} toolName={toolName} state="input-available" />
                }

                // Server-confirmed denial: the tool was never executed.
                if (part.state === 'output-denied') {
                  return (
                    <div key={i} className="my-1 flex items-center gap-2 text-xs text-gray-500">
                      <span className="text-red-500">✕</span>
                      <span>Cancelled: {toolName}</span>
                    </div>
                  )
                }

                return <ToolActivityIndicator key={i} toolName={toolName} state={part.state} />
              })}
              {message.role === 'assistant' && <ReasoningChainPanel steps={toolSteps} />}
            </div>
          )
        })}
      </div>
      <form
        onSubmit={e => { e.preventDefault(); if (input.trim()) { sendMessage({ text: input }); setInput('') } }}
        className="mt-2 flex gap-2"
      >
        <input value={input} onChange={e => setInput(e.target.value)} className="flex-1 rounded border px-3 py-2" placeholder="Ask a question..." />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">Send</button>
      </form>
    </div>
  )
}
