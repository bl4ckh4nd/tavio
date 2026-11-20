import { useEffect, useRef } from 'react'

/**
 * While `open`, the browser's Back button calls `onClose` instead of leaving the page.
 * The entry copies the current history state, so the router sees the same location.
 */
export function useHistoryEntry(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    let pushed = true
    window.history.pushState({ ...window.history.state, tavioOverlay: true }, '')
    const onPop = () => {
      pushed = false
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed with X or Esc: drop our entry, but never after the user navigated elsewhere.
      if (pushed && window.history.state?.tavioOverlay) window.history.back()
    }
  }, [open])
}
