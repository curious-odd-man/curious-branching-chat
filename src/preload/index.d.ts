import type { BranchChatApi } from '../shared/types/api'

declare global {
  interface Window {
    branchchat: BranchChatApi
  }
}

export {}
