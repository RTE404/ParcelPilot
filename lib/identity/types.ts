export type Surface = 'customer' | 'internal'
export type InternalRole = 'support_agent' | 'manager'

export interface SessionIdentity {
  surface: Surface
  accountId?: string
  staffId?: string
  role?: InternalRole
}
