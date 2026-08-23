import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// I8: ChatWindow's real useChat/Chat talk to a live transport; for a unit test of the
// initialPrompt auto-send guard we stub both to inert doubles, following this file's pattern
// of mocking a component's external deps at the module boundary (see e.g.
// app/api/chat/__tests__/route.test.ts for the same "mock the SDK, assert the call" shape).
const sendMessage = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({ messages: [], sendMessage }),
  Chat: class {
    constructor(..._args: unknown[]) {}
  },
}))

vi.mock('ai', () => ({
  DefaultChatTransport: class {
    constructor(..._args: unknown[]) {}
  },
  lastAssistantMessageIsCompleteWithApprovalResponses: () => false,
  isToolUIPart: () => false,
}))

import { ChatWindow } from '../ChatWindow'

describe('ChatWindow initialPrompt', () => {
  beforeEach(() => {
    sendMessage.mockClear()
  })

  it('auto-sends initialPrompt exactly once on mount, not on every re-render', () => {
    const { rerender } = render(<ChatWindow apiEndpoint="/api/chat" initialPrompt="Tell me about ticket TKT-501." />)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith({ text: 'Tell me about ticket TKT-501.' })

    // Re-rendering with the same props must not re-fire the effect (proves the useRef guard,
    // not just that it fired once by luck of a single render).
    rerender(<ChatWindow apiEndpoint="/api/chat" initialPrompt="Tell me about ticket TKT-501." />)
    rerender(<ChatWindow apiEndpoint="/api/chat" initialPrompt="Tell me about ticket TKT-501." />)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not auto-send anything when initialPrompt is omitted (every existing ChatWindow usage)', () => {
    render(<ChatWindow apiEndpoint="/api/chat" />)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
