import type { TaskBrief } from '../types.js'
import { diagnosePrompt } from './diagnose.js'
import { installPrompt } from './install.js'
import { refreshPrompt } from './refresh.js'
import { repairPrompt } from './repair.js'

/** Build the first user message for a run from its TaskBrief. */
export function buildInitialPrompt(brief: TaskBrief): string {
  switch (brief.intent) {
    case 'install':
      return installPrompt(brief)
    case 'refresh':
      return refreshPrompt(brief)
    case 'diagnose':
      return diagnosePrompt(brief)
    case 'repair':
      return repairPrompt(brief)
  }
}
