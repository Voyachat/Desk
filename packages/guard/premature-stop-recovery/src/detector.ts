/** Text-only detector for model replies that promise an immediate action and then stop. */

const CONDITIONAL_OFFER = /(?:如果|若(?:你)?|如需|需要我|你可以|if\s+you|would\s+you\s+like|i\s+can)/iu

const CHINESE_COMMITMENT = new RegExp(
  String.raw`(?:让我|我来|我会|我将|我先|接下来(?:我)?|现在(?:我)?|好[，,]?\s*(?:我)?)`
    + String.raw`(?:[^。！？!?]{0,120})`
    + String.raw`(?:开始|执行|搜索|查找|下载|检查|验证|创建|修改|更新|运行|调用|发起|发送|发|处理|继续|推进|看看|试试|请求)`
    + String.raw`(?:[^。！？!?]{0,24})[。！!：:]?$`,
  'u',
)

const ENGLISH_COMMITMENT = new RegExp(
  String.raw`(?:let\s+me|i(?:'ll|\s+will|\s+am\s+going\s+to)|next,?\s+i(?:'ll|\s+will)|now,?\s+i(?:'ll|\s+will)|okay,?\s+i(?:'ll|\s+will))`
    + String.raw`[^.!?]{0,160}`
    + String.raw`(?:start|run|call|search|download|check|verify|create|edit|update|send|request|continue|proceed|do\s+that)`
    + String.raw`[^.!?]{0,32}[.!:]?$`,
  'iu',
)

/**
 * Return whether the visible tail makes an unconditional, immediate action
 * commitment without reporting that action's result.
 * @param text - assistant-visible text from one provider `stop` response.
 * @returns `true` only for the bounded Chinese or English commitment forms.
 */
export function looksLikePrematureStop(text: string): boolean {
  const normalized = text.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length === 0) return false
  const tail = normalized.slice(-320)
  const sentence = tail.split(/(?<=[。！？!?])\s*/u).at(-1) ?? tail
  if (CONDITIONAL_OFFER.test(sentence)) return false
  return CHINESE_COMMITMENT.test(tail) || ENGLISH_COMMITMENT.test(tail)
}
