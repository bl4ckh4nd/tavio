import { useRef, useEffect, useState } from 'react'
import { authClient } from '../lib/authClient'
import { useConvexAuth } from 'convex/react'

// Grace period to wait before treating loading as "not authenticated"
// This allows HMR reconnects to complete without triggering redirects
const AUTH_STABILIZATION_MS = 2000

// Key for persisting auth state across HMR
const AUTH_STATE_KEY = 'tavio:lastAuthState'

interface StableAuthState {
  isLoading: boolean
  isAuthenticated: boolean
  isTransient: boolean
}

// Read persisted auth state (survives HMR module reload)
function getPersistedAuthState(): boolean | null {
  try {
    const stored = sessionStorage.getItem(AUTH_STATE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
    return null
  } catch {
    return null
  }
}

// Persist auth state to survive HMR
function setPersistedAuthState(isAuthenticated: boolean): void {
  try {
    sessionStorage.setItem(AUTH_STATE_KEY, String(isAuthenticated))
  } catch {
    // Ignore storage errors
  }
}

/**
 * A hook that provides stable authentication state that won't flicker
 * during transient loading states (like HMR reconnects).
 *
 * During the grace period, if the user was previously authenticated,
 * we preserve that state to prevent unwanted redirects.
 *
 * Uses sessionStorage to persist auth state across HMR module reloads.
 */
export function useStableAuth(): StableAuthState {
  const { data: session, isPending } = authClient.useSession()
  const { isLoading: isConvexLoading, isAuthenticated: isConvexAuth } = useConvexAuth()

  // Initialize from persisted state (survives HMR)
  const lastAuthRef = useRef<boolean | null>(getPersistedAuthState())
  // Track when loading started for grace period calculation
  const loadingStartRef = useRef<number | null>(null)

  // Start with isTransient: true during initial load to prevent immediate redirects
  const [stableAuth, setStableAuth] = useState<StableAuthState>(() => ({
    isLoading: true,
    isAuthenticated: lastAuthRef.current ?? false,
    isTransient: true, // Always start as transient during initial load
  }))

  useEffect(() => {
    const isLoading = isPending || isConvexLoading
    const hasSession = session !== null
    const isAuthenticated = hasSession && isConvexAuth

    if (isLoading) {
      // Loading state detected
      if (loadingStartRef.current === null) {
        loadingStartRef.current = Date.now()
      }

      const elapsed = Date.now() - loadingStartRef.current
      const withinGracePeriod = elapsed < AUTH_STABILIZATION_MS

      // During grace period, preserve last known auth state if user was authenticated
      if (withinGracePeriod && lastAuthRef.current === true) {
        setStableAuth({
          isLoading: true,
          isAuthenticated: true, // Preserve auth during transient state
          isTransient: true,
        })
      } else if (withinGracePeriod) {
        // Still in grace period but no previous auth - stay transient
        setStableAuth({
          isLoading: true,
          isAuthenticated: lastAuthRef.current ?? false,
          isTransient: true,
        })
      } else {
        // Grace period expired - auth state is definitively loading
        setStableAuth({
          isLoading: true,
          isAuthenticated: lastAuthRef.current ?? false,
          isTransient: false,
        })
      }
    } else {
      // Auth state has settled
      loadingStartRef.current = null
      lastAuthRef.current = isAuthenticated
      setPersistedAuthState(isAuthenticated) // Persist for HMR survival
      setStableAuth({
        isLoading: false,
        isAuthenticated,
        isTransient: false,
      })
    }
  }, [isPending, isConvexLoading, session, isConvexAuth])

  useEffect(() => {
    if (isPending || isConvexLoading) return

    const hasSession = session !== null
    if (hasSession && !isConvexAuth) {
      // eslint-disable-next-line no-console
      console.warn(
        '[useStableAuth] Better Auth session exists but Convex auth is false. Check CONVEX_SITE_URL/SITE_URL and auth bridge config.'
      )
    }
  }, [isPending, isConvexLoading, session, isConvexAuth])

  return stableAuth
}
