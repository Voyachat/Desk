/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** One localized permission mode presentation. */
export interface PermissionPresetPresentation {
  label: string
  description: string | undefined
}

const BUILTIN_KEYS: Partial<Record<string, 'readOnly' | 'workspaceWrite' | 'fullAccess'>> = {
  'read-only': 'readOnly',
  'workspace-write': 'workspaceWrite',
  [FULL_ACCESS_PRESET]: 'fullAccess',
}

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Resolve built-in presets through the active locale and preserve custom host copy.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param description - host-supplied explanation for custom presets.
 * @param t - active locale translator.
 * @returns the localized built-in or host fallback presentation.
 */
export function permissionPresetPresentation(
  value: string,
  name: string,
  description: string | undefined,
  t: (key: string) => string,
): PermissionPresetPresentation {
  const builtin = BUILTIN_KEYS[value]
  if (builtin === undefined) return { label: displayPresetName(name), description }
  return {
    label: t(`mode.${builtin}.title`),
    description: t(`mode.${builtin}.description`),
  }
}
