import { useState } from 'react'

type ApplyChangesFn = (changes: any[]) => Promise<void>

export function useOptimizer(onRefresh: () => void, onApplyChanges?: ApplyChangesFn) {
  const [proposal, setProposal] = useState<any>(null)
  const [isApplying, setIsApplying] = useState(false)

  // This function takes the AI's JSON and opens the preview modal
  const openPreview = (aiResponse: any) => {
    if (aiResponse?.type === 'proposal') {
      setProposal(aiResponse)
    }
  }

  // Apply proposal changes and refresh schedule state
  const confirmChanges = async (changes: any[]) => {
    setIsApplying(true)
    try {
      if (onApplyChanges) {
        await onApplyChanges(changes)
      } else {
        // Fallback for legacy callers: close preview and refresh only.
        console.warn('Optimizer confirm called without apply handler; no persistence occurred.')
      }

      setProposal(null)
      if (onRefresh) onRefresh()
    } finally {
      setIsApplying(false)
    }
  }

  return {
    proposal,
    isApplying,
    openPreview,
    confirmChanges,
    closePreview: () => setProposal(null)
  }
}