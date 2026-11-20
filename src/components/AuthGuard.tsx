import { t } from '@lingui/core/macro'
import React, { useEffect } from 'react'
import { useStableAuth } from '../hooks/useStableAuth'
import { useRouter } from '@tanstack/react-router'
import { BrandMark } from './BrandMark'

interface AuthGuardProps {
  children: React.ReactNode
  /** Custom loading fallback component */
  fallback?: React.ReactNode
  /** Where to redirect when not authenticated. Defaults to /auth/login */
  redirectTo?: string
}

/**
 * AuthGuard protects routes that require authentication.
 *
 * During transient loading states (like HMR), it shows a loading spinner
 * instead of redirecting. Only redirects when auth definitively settles
 * to "not authenticated".
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({
  children,
  fallback,
  redirectTo = '/auth/login',
}) => {
  const { isLoading, isAuthenticated, isTransient } = useStableAuth()
  const router = useRouter()

  // Redirect when auth settles to not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // eslint-disable-next-line no-console
      console.log('[AuthGuard] Not authenticated, redirecting to', redirectTo)
      router.navigate({ to: redirectTo })
    }
  }, [isLoading, isAuthenticated, router, redirectTo])

  // Show loading during transient states to prevent flash redirects
  if (isLoading && isTransient) {
    return (
      fallback ?? (
        <div className="g-desk th">
          <div className="th__top"><BrandMark logoClassName="bar__logo" /></div>
          <div role="status" aria-label={t`Loading...`} className="grid place-items-center pb-[72px] text-muted">
            <span className="spin size-[22px]" aria-hidden="true" />
          </div>
        </div>
      )
    )
  }

  // Not authenticated and not loading - render nothing while redirect happens
  if (!isLoading && !isAuthenticated) {
    return null
  }

  // Authenticated - render children
  return <>{children}</>
}
