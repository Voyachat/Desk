/** Strict production browser entry for the Cloud and Local Capability workbench. */

import { apply as cloudProductApply } from '@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts'

/** Services that must all exist before the V2 workbench registers any UI. */
export const inject = ['slots', 'employeeExperience', 'localCapability']

/** Reuse the production workbench only after every strict V2 service is ready. */
export const apply = cloudProductApply

export {
  createCloudProductStore,
  createCloudWorkbenchInjected,
  createEmployeeExperienceExternalStore,
  createLocalCapabilityExternalStore,
  createLocalCapabilityWorkbenchInjected,
  useEmployeeExperience,
  useLocalCapability,
} from '@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts'

export type {
  CloudWorkbenchInjected,
  LocalCapabilityWorkbenchInjected,
} from '@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts'
