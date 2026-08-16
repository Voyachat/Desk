/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-16.1'

/** The complete editable product welcome notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用 Voyaseek',
    body: 'Voyaseek 目前的 0.1 版本仍处于快速迭代阶段，许多能力需要持续改进和打磨，我们希望听取您的反馈和建议。\n\n人工智能输出可能存在错误或偏差；涉及重要决策、文件改动或对外操作时，请先确认后果再执行。感谢您的信任与陪伴。',
    continueLabel: '继续',
  },
  en: {
    title: 'Welcome to Voyaseek',
    body: 'Voyaseek 0.1 is evolving rapidly. Many areas still need improvement, and we welcome your feedback.\n\nAI output may contain mistakes. Before approving important decisions, file changes, or external actions, please review the consequences. Thank you for your trust.',
    continueLabel: 'Continue',
  },
} as const
