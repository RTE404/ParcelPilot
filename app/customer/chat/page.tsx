import { requireSession } from '@/lib/identity/requireSession'
import { getAccountById } from '@/lib/data/loadData'
import { IdentityBadge } from '@/components/IdentityBadge'
import { ChatWindow } from '@/components/ChatWindow'

export default async function CustomerChat() {
  const session = await requireSession('customer')
  const account = getAccountById(session.accountId!)
  return (
    <>
      <IdentityBadge name={account?.accountName ?? session.accountId!} sublabel="Customer" switchHref="/customer/login" />
      <ChatWindow apiEndpoint="/api/chat" />
    </>
  )
}
