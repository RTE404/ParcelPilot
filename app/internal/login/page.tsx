'use client'
import { useRouter } from 'next/navigation'

const OPTIONS = [
  { key: 'rohit', label: 'Rohit — Support Agent' },
  { key: 'priya', label: 'Priya Mehta — Manager' },
]

export default function InternalLogin() {
  const router = useRouter()
  async function login(key: string) {
    await fetch('/api/login', { method: 'POST', body: JSON.stringify({ key, redirectTo: '/internal/chat' }) })
    router.push('/internal/chat')
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
