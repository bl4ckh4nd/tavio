import React from 'react'
import { useConvexAuth } from 'convex/react'
import { authClient } from './authClient'
import { useStableAuth } from '../hooks/useStableAuth'

const AuthDebugLoggerInner: React.FC = () => {
  const { data: session, isPending } = authClient.useSession()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const stableAuth = useStableAuth()
  const sessionId = session?.session?.id

  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[AuthDebug] better-auth session changed', { session, isPending })
  }, [session, isPending])

  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[AuthDebug] convex auth state changed', { isLoading, isAuthenticated })
  }, [isLoading, isAuthenticated])

  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[AuthDebug] stable auth state changed', stableAuth)
  }, [stableAuth])

  React.useEffect(() => {
    if (!sessionId) return

    let cancelled = false
    ;(async () => {
      try {
        const result = await authClient.convex.token()
        if (cancelled) return
        const token = result?.data?.token
        if (token) {
          // eslint-disable-next-line no-console
          console.log('[AuthDebug] convex token exchange succeeded', {
            hasToken: true,
          })
          return
        }
        // eslint-disable-next-line no-console
        console.error('[AuthDebug] convex token exchange returned no token', {
          error: (result as any)?.error,
          status: (result as any)?.error?.status,
          message: (result as any)?.error?.message,
        })
      } catch (error) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.error('[AuthDebug] convex token exchange failed', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  React.useEffect(() => {
    if (isPending || isLoading) return
    if (session && !isAuthenticated) {
      // eslint-disable-next-line no-console
      console.warn('[AuthDebug] session present but Convex reports unauthenticated')
    }
  }, [isPending, isLoading, session, isAuthenticated])

  return null
}

export const AuthDebugLogger: React.FC = () => {
  if (!import.meta.env.DEV) return null
  return <AuthDebugLoggerInner />
}
