import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UserRole } from '../types'
import { BreakoutRooms } from './BreakoutRooms'

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@lingui/core/macro', () => ({ t: (strings: TemplateStringsArray) => strings[0] }))

describe('BreakoutRooms mobile assignment', () => {
  it('tells people who cannot start breakouts that none are running, without the setup', () => {
    render(
      <BreakoutRooms
        isOpen
        onClose={vi.fn()}
        participants={[]}
        rooms={[]}
        isActive={false}
        onStartSession={vi.fn()}
        onEndSession={vi.fn()}
        onJoinRoom={vi.fn()}
      />,
    )
    expect(screen.getByText('The host has not started breakout rooms yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument()
  })

  it('offers a native assignment select alongside desktop drag and drop', async () => {
    const onStartSession = vi.fn()
    render(
      <BreakoutRooms
        isOpen
        onClose={vi.fn()}
        participants={[
          { id: 'alice', name: 'Alice', role: UserRole.PARTICIPANT, isMuted: false, isCameraOff: false, isScreenSharing: false, isHandRaised: false },
          { id: 'bob', name: 'Bob', role: UserRole.PARTICIPANT, isMuted: false, isCameraOff: false, isScreenSharing: false, isHandRaised: false },
        ]}
        rooms={[]}
        isActive={false}
        onStartSession={onStartSession}
        onEndSession={vi.fn()}
        onJoinRoom={vi.fn()}
        canManage
      />,
    )
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))
    const assignmentSelect = screen.getAllByRole('combobox')[0]
    const targetRoom = assignmentSelect.querySelectorAll('option')[2]?.getAttribute('value')
    expect(targetRoom).toBeTruthy()
    fireEvent.change(assignmentSelect, { target: { value: targetRoom } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    expect(onStartSession).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ participantIds: expect.arrayContaining(['alice']) }),
    ]))
  })

  it('requires confirmation and blocks repeated breakout termination requests', async () => {
    let resolveEnd: ((ended: boolean) => void) | undefined
    const onEndSession = vi.fn(() => new Promise<boolean>(resolve => { resolveEnd = resolve }))
    render(
      <BreakoutRooms
        isOpen
        onClose={vi.fn()}
        participants={[]}
        rooms={[]}
        isActive
        onStartSession={vi.fn()}
        onEndSession={onEndSession}
        onJoinRoom={vi.fn()}
        canManage
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'End Session' }))
    expect(onEndSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'End breakout session' })).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: 'End session' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onEndSession).toHaveBeenCalledTimes(1)
    expect(confirm).toBeDisabled()

    resolveEnd?.(true)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End breakout session' })).not.toBeInTheDocument())
  })
})
