import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="mb-6 text-2xl font-semibold">ParcelPilot Support</h1>
      <div className="grid grid-cols-2 gap-4">
        <Link href="/customer/login" className="rounded-lg border p-6 hover:bg-gray-100">
          <h2 className="font-medium">Customer Support</h2>
          <p className="text-sm text-gray-500">For ParcelPilot customers</p>
        </Link>
        <Link href="/internal/login" className="rounded-lg border p-6 hover:bg-gray-100">
          <h2 className="font-medium">ParcelPilot Internal</h2>
          <p className="text-sm text-gray-500">For support & ops staff</p>
        </Link>
      </div>
    </main>
  )
}
