/**
 * Alternative agent-driver contract served by the loop factory. A deployment
 * registers one factory per runtime id; sessions whose header records that id
 * are driven by the matching driver instead of the default loop agent.
 * @module @deepseek-ai/dsh-agent-loop/driver
 */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'

/**
 * A driver the loop factory publishes in place of the default loop agent.
 * Cancellation, quiescence, and inbox semantics follow the {@link Agent}
 * contract; the factory's teardown cancels the driver, awaits quiescence, and
 * then disposes {@link scope}, so contributions registered on the driver's
 * scope unwind with its lifecycle exactly like the default driver's.
 */
export interface AgentDriver extends Agent {
  /** The driver's agent-scoped registration boundary; factory teardown disposes it after driver quiescence. */
  readonly scope: Scope
}

/** Construction inputs for one driver over a prepared, unpublished session. */
export interface CreateDriverInput {
  /** The single identity shared by the agent registry and the session log. */
  readonly id: SessionId
  /** Per-agent options (model route, caps); interpretation belongs to the driver. */
  readonly options: AgentOptions
  /** The prepared session the driver owns; its header carries the selecting runtime. */
  readonly session: Session
}

/**
 * An alternative driver supplier registered on the loop factory through
 * {@link AgentLoop.registerDriverFactory}. One factory serves one exact
 * runtime id; the session header's `agentRuntime` selects it at driver
 * construction, so a resumed session rebuilds under the runtime that produced
 * its history.
 */
export interface AgentDriverFactory {
  /** The runtime id this factory serves; matches the session header value that selects it. */
  readonly runtime: string
  /**
   * Construct a driver for one prepared session. Composition only: the factory
   * publishes and starts the returned driver; construction must not drive.
   * @param input - identity, options, and the prepared session.
   * @returns the unpublished driver.
   */
  createDriver(input: CreateDriverInput): AgentDriver
}
