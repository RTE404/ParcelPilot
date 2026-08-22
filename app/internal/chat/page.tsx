import Link from 'next/link'
import { requireSession } from '@/lib/identity/requireSession'
import { IdentityBadge } from '@/components/IdentityBadge'
import { ChatWindow } from '@/components/ChatWindow'

const STAFF_NAMES: Record<string, string> = { rohit: 'Rohit', priya_mehta: 'Priya Mehta' }

export default async function InternalChat() {
  const session = await requireSession('internal')
  return (
    <>
      <IdentityBadge name={STAFF_NAMES[session.staffId!] ?? session.staffId!} sublabel={session.role === 'manager' ? 'Manager' : 'Support Agent'} switchHref="/internal/login" />
      {session.role === 'manager' && (
        <div className="border-b bg-blue-50 px-4 py-2 text-sm">
          <Link href="/internal/dashboard" className="text-blue-700 hover:underline">Open issue-detection dashboard →</Link>
        </div>
      )}
      <ChatWindow apiEndpoint="/api/chat" />
    </>
  )
}
