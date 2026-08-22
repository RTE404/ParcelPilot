'use client'
import { useRouter } from 'next/navigation'

const OPTIONS = [
  { key: 'northstar', label: 'Northstar Logistics' },
  { key: 'lumenworks', label: 'LumenWorks' },
  { key: 'beacon', label: 'Beacon Retail' },
  { key: 'axislabs', label: 'Axis Labs' },
]

export default function CustomerLogin() {
  const router = useRouter()
  async function login(key: string) {
    await fetch('/api/login', { method: 'POST', body: JSON.stringify({ key, redirectTo: '/customer/chat' }) })
    router.push('/customer/chat')
  }
  return (
    <main className="mx-auto max-w-md p-10">
      <h1 className="mb-6 text-xl font-semibold">Log in as...</h1>
      <div className="flex flex-col gap-2">
        {OPTIONS.map(o => (
          <button key={o.key} onClick={() => login(o.key)} className="rounded border p-3 text-left hover:bg-gray-100">
            {o.label}
          </button>
        ))}
      </div>
    </main>
  )
}
