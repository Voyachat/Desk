import { createRequire } from 'node:module'

// Electron 42 eagerly evaluates unrelated getters for ESM named imports. Read
// only the APIs this process owns so importing the main module cannot
// initialize safeStorage and prompt for a Keychain item we never use.
const electron = createRequire(import.meta.url)('electron') as typeof import('electron')

export const { app, BrowserWindow, dialog, session } = electron
