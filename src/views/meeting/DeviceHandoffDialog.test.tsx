import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { DeviceHandoffDialog } from './DeviceHandoffDialog'

describe('device handoff dialog', () => {
  it('renders the one-time link, QR target, countdown and cancel action', () => {
    render(<DeviceHandoffDialog
      show
      darkMode={false}
      code="handoff-1.secret"
      expiresAt={Date.now() + 5 * 60 * 1000}
      onCreate={vi.fn()}
      onCancel={vi.fn()}
      onClose={vi.fn()}
    />)
    expect(screen.getByDisplayValue(`${window.location.origin}/handoff/handoff-1.secret`)).toBeInTheDocument()
    expect(screen.getByText(/Expires in/)).toBeInTheDocument()
    expect(screen.getByText('Cancel link')).toBeInTheDocument()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })
})
