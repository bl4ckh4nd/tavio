import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHistoryEntry } from './useHistoryEntry'

describe('useHistoryEntry', () => {
  it('closes on Back and adds exactly one history entry while open', () => {
    const onClose = vi.fn()
    const before = window.history.length
    const { rerender, unmount } = renderHook(({ open }) => useHistoryEntry(open, onClose), { initialProps: { open: false } })
    expect(window.history.length).toBe(before)
    rerender({ open: true })
    expect(window.history.length).toBe(before + 1)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does not touch history when closed', () => {
    const back = vi.spyOn(window.history, 'back')
    const { unmount } = renderHook(() => useHistoryEntry(false, () => {}))
    unmount()
    expect(back).not.toHaveBeenCalled()
    back.mockRestore()
  })
})
