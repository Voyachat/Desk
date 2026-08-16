/**
 * Fixed identities the Claude driver writes into DSH surfaces.
 * @module @deepseek-ai/dsh-claude-agent/constants
 */

/** The agent runtime id this package serves and matches against session headers. */
export const CLAUDE_RUNTIME = 'claude'

/** The provider name recorded on assistant messages produced by the SDK. */
export const CLAUDE_PROVIDER = 'claude-agent'
