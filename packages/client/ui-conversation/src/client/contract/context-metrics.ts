/** Pure context-capacity readings shared by conversation presentation domains. */

import type { ContextPressureProjection } from '@voyaseek-ai/dsh-token-meter/client'

/** Derived context occupancy with the displayed numerator and capacity. */
export interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M.
 * @param value - token count.
 * @returns display string.
 */
export function formatTokens(value: number): string {
  const scaled = (amount: number): string =>
    amount >= 100 ? String(Math.round(amount)) : String(Math.round(amount * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/**
 * Approximate context occupancy from the latest projected usage and route capacity.
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy, or null until both values are known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}
