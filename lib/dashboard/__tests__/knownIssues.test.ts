import { describe, it, expect } from 'vitest'
import { matchKnownIssue } from '../knownIssues'

describe('matchKnownIssue', () => {
  describe('KI-208 (bulk upload / CSV row-count failures)', () => {
    it('does not match a ticket that merely contains the substring "row" inside another word', () => {
      expect(matchKnownIssue('The customer says the page will not load in their browser.')).not.toBe('KI-208')
      expect(matchKnownIssue('Sales continue to grow this quarter.')).not.toBe('KI-208')
      expect(matchKnownIssue('Please throw an error instead of failing silently.')).not.toBe('KI-208')
    })

    it('matches a ticket mentioning a hyphenated row count, e.g. "3,500-row CSV"', () => {
      expect(matchKnownIssue('Bulk upload fails for 3,500-row CSV files.')).toBe('KI-208')
    })

    it('matches a ticket mentioning a plain row count, e.g. "3500 rows"', () => {
      expect(matchKnownIssue('The CSV upload fails once the file has more than 3500 rows.')).toBe('KI-208')
    })

    it('still matches on the "csv" and "bulk upload" keywords directly', () => {
      expect(matchKnownIssue('Bulk upload is failing for our CSV files.')).toBe('KI-208')
    })
  })

  describe('KI-211 (SwiftShip webhook / still-shows-BOOKED)', () => {
    it('does not match a pickup problem unrelated to SwiftShip or webhooks', () => {
      const result = matchKnownIssue('Our driver missed the scheduled pickup window entirely.')
      expect(result).toBeNull()
    })

    it('matches the original SwiftShip/webhook scenario', () => {
      const result = matchKnownIssue('SwiftShip order still shows BOOKED after driver pickup; likely a missed webhook.')
      expect(result).toBe('KI-211')
    })

    it('matches on "still shows booked" and "webhook" alone, without needing "pickup"', () => {
      expect(matchKnownIssue('SwiftShip order still shows booked in the dashboard.')).toBe('KI-211')
      expect(matchKnownIssue('The webhook for this SwiftShip order never fired.')).toBe('KI-211')
    })
  })

  it('returns null for text matching no known issue', () => {
    expect(matchKnownIssue('Customer wants to update their billing contact email.')).toBeNull()
  })
})
