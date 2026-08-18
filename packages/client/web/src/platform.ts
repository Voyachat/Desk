/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @voyaseek-ai/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@voyaseek-ai/cordis',
  '@voyaseek-ai/dsh-client-ui-slots',
  '@voyaseek-ai/dsh-client-web-react',
  '@voyaseek-ai/dsh-client-ui-primitives',
  '@voyaseek-ai/dsh-client-ui-attachment',
  '@voyaseek-ai/dsh-client-schema-form',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
