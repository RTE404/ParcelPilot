import Link from 'next/link'

export function IdentityBadge({ name, sublabel, switchHref }: { name: string; sublabel: string; switchHref: string }) {
  return (
    <div className="flex items-center justify-between border-b bg-white px-4 py-2 text-sm">
      <div>
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-gray-500">{sublabel}</span>
      </div>
      <Link href={switchHref} className="text-blue-600 hover:underline">Switch identity</Link>
    </div>
  )
}
