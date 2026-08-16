/**
 * Model-family knowledge for OpenAI-compatible endpoints: which listed models
 * can serve an agent conversation, and the capabilities a listing does not
 * disclose. Endpoints such as DashScope answer `GET /models` with every model
 * they host — text embeddings, TTS voices, image generators, realtime audio
 * sockets, and chat models alike — and disclose nothing but ids. Adopting such
 * a listing wholesale puts models an agent cannot use beside the ones it can,
 * and serves the usable ones with guessed capacities. This module is the
 * correction: one classification every discovery and every materialized model
 * passes through.
 *
 * The stance is asymmetric by design. A model this module does not know stays
 * servable: hiding an unknown model would break gateways this knowledge base
 * has never seen, while admitting one the endpoint cannot serve fails with the
 * provider's own diagnostic. Only a POSITIVE match on a known non-chat family
 * (embeddings, rerankers, image and video generators, TTS and ASR endpoints,
 * realtime websocket models) or a known tool-less family removes a model, and
 * a profile entry that declares its own input modalities always wins over the
 * classification.
 *
 * Capability facts are advisory defaults, not claims: each one sits below an
 * explicit profile entry and above the route's own defaults, and a value the
 * installed pi-ai catalog ships is never displaced. Chat capacities here come
 * from the upstream pi-ai qwen-token-plan catalog, which describes the same
 * model families on Alibaba Cloud's OpenAI-compatible endpoints.
 *
 * @module dsh-llm-pi-ai/model-families
 */

import type { PiAiModality, PiAiReasoningEfforts } from './catalog.ts'

/** What a family classification decides about one listed model id. */
export interface ModelFamilyClassification {
  /**
   * Whether the model can serve an agent conversation: chat completion with
   * tool calling. False for models of another modality and for chat models
   * that refuse tool calls, which an agent request always carries.
   */
  agentServable: boolean
  /** Why a model is not servable; absent for servable ones. */
  reason?: string
  /** Capability defaults the listing would not disclose; absent when unknown. */
  facts?: ModelFamilyFacts
}

/** Capability defaults one known chat family carries. */
export interface ModelFamilyFacts {
  /** Maximum combined request and response context in tokens. */
  contextWindow?: number
  /** Maximum output tokens. */
  maxTokens?: number
  /** Request modalities the family accepts. */
  input?: readonly PiAiModality[]
  /**
   * Selectable reasoning efforts the family offers, in the profile-field
   * vocabulary: the same dict a `models` entry's `reasoningEfforts` takes.
   */
  reasoningEfforts?: PiAiReasoningEfforts
}

/**
 * The efforts a hybrid-reasoning gateway family offers when its endpoint
 * accepts the OpenAI-style `reasoning_effort` parameter across levels:
 * `off` sends nothing (the endpoint's own default decides), the rest send
 * their own spelling. DashScope, where every probed reasoning family accepted
 * the parameter, is the consumer this was written for.
 */
const OPENAI_STYLE_EFFORTS: PiAiReasoningEfforts = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

/** One known family's entry: servable chat facts, or the reason it is not. */
interface FamilyEntry {
  /** Servable chat families carry facts; the rest carry a reason. */
  facts?: ModelFamilyFacts
  /** The classification reason for a family an agent cannot use. */
  unservable?: string
}

/** Vision input for the families that accept it. */
const VISION: readonly PiAiModality[] = ['text', 'image']

/**
 * Known model families keyed by their normalized stem: lowercase, owner prefix
 * removed (`kimi/kimi-k3` walks in as `kimi-k3`), dated snapshot suffixes
 * stripped before lookup (`qwen3-max-2026-01-23` as `qwen3-max`). Chat
 * capacities are the upstream pi-ai qwen-token-plan catalog's values for the
 * same families; reasoning sets come from endpoint probes that answered a
 * streamed chat completion with tool definitions.
 */
const MODEL_FAMILIES: Readonly<Record<string, FamilyEntry>> = {
  // --- Alibaba Qwen chat families ---
  'qwen3.8-max': { facts: { contextWindow: 1_000_000, maxTokens: 131_072, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.8-max-preview': { facts: { contextWindow: 1_000_000, maxTokens: 131_072, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.7-max': { facts: { contextWindow: 1_000_000, maxTokens: 131_072, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.7-plus': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.7-flash': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.6-plus': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.6-flash': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-plus': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-flash': { facts: { contextWindow: 1_000_000, maxTokens: 65_536, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-122b-a10b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-397b-a17b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-35b-a3b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3.5-27b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-max': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-32b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-14b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-8b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-30b-a3b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-30b-a3b-thinking': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-235b-a22b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-235b-a22b-thinking': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-next-80b-a3b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwen3-next-80b-a3b-thinking': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qwq-plus': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qvq-plus': { facts: { input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'qvq-max': { facts: { input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // Vision chat without a reasoning claim: the harness sends text either way.
  'qwen3-vl-plus': { facts: { input: VISION } },
  'qwen3-vl-flash': { facts: { input: VISION } },
  'qwen-vl-max': { facts: { input: VISION } },
  'qwen-vl-plus': { facts: { input: VISION } },
  'qwen-vl-ocr': { facts: { input: VISION } },
  'qwen3.5-ocr': { facts: { input: VISION } },
  // Omni models serve chat over HTTP in their non-realtime variants; the
  // realtime ones are websocket-only and fall to the pattern rules below.
  'qwen3-omni-flash': { facts: {} },
  'qwen3.5-omni-flash': { facts: {} },
  'qwen3.5-omni-plus': { facts: {} },
  'qwen-omni-turbo': { facts: {} },
  // Long-context reader; the context figure is public product documentation.
  'qwen-long': { facts: { contextWindow: 10_000_000 } },
  // --- DeepSeek families served through compatible gateways ---
  'deepseek-v4-pro': { facts: { contextWindow: 1_000_000, maxTokens: 384_000, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-v4-flash': { facts: { contextWindow: 1_000_000, maxTokens: 384_000, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-v3.2': { facts: { contextWindow: 131_072, maxTokens: 65_536, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-v3.1': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-llama-70b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-llama-8b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-qwen-32b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-qwen-14b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-qwen-7b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'deepseek-r1-distill-qwen-1.5b': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // --- Zhipu GLM families ---
  'glm-5.2': { facts: { contextWindow: 1_000_000, maxTokens: 131_072, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'glm-5.2-fast-preview': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'glm-5.1': { facts: { contextWindow: 202_752, maxTokens: 128_000, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'glm-5': { facts: { contextWindow: 202_752, maxTokens: 16_384, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'glm-4.7': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // --- Moonshot Kimi families ---
  'kimi-k2.7-code': { facts: { contextWindow: 262_144, maxTokens: 262_144, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'kimi-k2.7-code-highspeed': { facts: { contextWindow: 262_144, maxTokens: 262_144, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'kimi-k2.6': { facts: { contextWindow: 262_144, maxTokens: 262_144, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'kimi-k2.5': { facts: { contextWindow: 262_144, maxTokens: 98_304, input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'kimi-k3': { facts: { input: VISION, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'kimi-k2-thinking': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // --- MiniMax M series ---
  'minimax-m3': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'minimax-m2.7': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'minimax-m2.5': { facts: { contextWindow: 196_608, maxTokens: 32_768, reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  'minimax-m2.1': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // --- Xiaomi MiMo ---
  'mimo-v2.5-pro': { facts: { reasoningEfforts: OPENAI_STYLE_EFFORTS } },
  // Chat models an agent still cannot use: they refuse the tool calls every
  // agent request carries. They stay configured and listed on the Models page;
  // only the conversation directory stops offering them.
  'qwen-mt-lite': { unservable: 'a translation model that refuses tool calls' },
  'qwen-mt-flash': { unservable: 'a translation model that refuses tool calls' },
  'qwen-mt-turbo': { unservable: 'a translation model that refuses tool calls' },
  'qwen-mt-plus': { unservable: 'a translation model that refuses tool calls' },
  'qwen-deep-research': { unservable: 'a research model that refuses tool calls' },
  'qwen-deep-search-planning': { unservable: 'a research model that refuses tool calls' },
}

/**
 * Suffixes a snapshot id carries after its family stem, most specific first.
 * Stripping walks them repeatedly, so `qwen3-max-2026-01-23` and
 * `deepseek-v4-pro-0813` both land on the stem the family table keys by.
 */
const SNAPSHOT_SUFFIXES: readonly RegExp[] = [
  /-\d{4}-\d{2}-\d{2}$/,
  /-\d{4}$/,
  /-latest$/,
  /-preview$/,
  /-snapshot$/,
]

/**
 * The lookup candidates one model id produces: itself, then its family stems
 * with snapshot suffixes stripped one at a time. The exact id leads so a table
 * entry for a dated snapshot wins over its family's.
 * @param id - model id as the endpoint or the profile spells it.
 * @returns normalized lookup keys, most specific first.
 */
function familyCandidates(id: string): readonly string[] {
  let stem = id.trim().toLowerCase()
  const slash = stem.lastIndexOf('/')
  if (slash >= 0) stem = stem.slice(slash + 1)
  const candidates = [stem]
  for (;;) {
    const pattern = SNAPSHOT_SUFFIXES.find(candidate => candidate.test(stem))
    if (pattern === undefined) break
    stem = stem.replace(pattern, '')
    if (stem.length === 0) break
    candidates.push(stem)
  }
  return candidates
}

/**
 * Family-table facts or refusal for one model id, when the table knows it.
 * @param id - model id as the endpoint or the profile spells it.
 * @returns the family entry, or undefined for a family the table does not name.
 */
function familyEntry(id: string): FamilyEntry | undefined {
  for (const candidate of familyCandidates(id)) {
    const entry = MODEL_FAMILIES[candidate]
    if (entry !== undefined) return entry
  }
  return undefined
}

/**
 * Pattern rules for the non-chat modalities an OpenAI-compatible listing
 * advertises beside its chat models. Only a positive match removes a model:
 * an id these rules do not recognize stays servable, which is how a gateway
 * this knowledge base has never seen keeps working.
 */
const NON_CHAT_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /embedding/, reason: 'an embedding model, not a chat model' },
  { pattern: /(^gte-|rerank)/, reason: 'a rerank model, not a chat model' },
  { pattern: /(^|[-./])tts([-./]|$)|speech-/, reason: 'a speech-synthesis model, not a chat model' },
  { pattern: /(^|[-./])asr([-./]|$)|paraformer|sensevoice/, reason: 'a speech-recognition model, not a chat model' },
  { pattern: /realtime|livetranslate/, reason: 'a realtime streaming model served over websockets, not chat completions' },
  { pattern: /^qwen-audio/, reason: 'an audio model that refuses HTTP chat completions' },
  { pattern: /^wan[0-9x]|^wanx|^qwen-image|^z-image|image-edit|image-generation/, reason: 'an image-generation model, not a chat model' },
  { pattern: /video-generation|-video($|[-.])/, reason: 'a video-generation model, not a chat model' },
  { pattern: /^test-|sre-gpu/, reason: 'an internal infrastructure model, not a chat model' },
]

/**
 * Classify one model id for agent service: servable with whatever capability
 * facts the family table carries, or refused with the reason the table or the
 * pattern rules name. Unknown families are servable by construction.
 * @param id - model id as the endpoint or the profile spells it.
 * @returns the classification every discovery and materialization applies.
 */
export function classifyModel(id: string): ModelFamilyClassification {
  const entry = familyEntry(id)
  if (entry !== undefined) {
    return entry.unservable !== undefined
      ? { agentServable: false, reason: entry.unservable }
      : { agentServable: true, ...entry.facts !== undefined && Object.keys(entry.facts).length > 0 ? { facts: entry.facts } : {} }
  }
  for (const rule of NON_CHAT_PATTERNS) {
    if (rule.pattern.test(id.toLowerCase())) return { agentServable: false, reason: rule.reason }
  }
  return { agentServable: true }
}
