'use client'

import { LiveOnly } from '@/components/LiveOnly'
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTideCloak } from '@tidecloak/nextjs';

function RedirectPage() {
  const { authenticated, isInitializing, logout } = useTideCloak()
  const router = useRouter()
  // Generic landing message shown briefly after any login while auth resolves.
  // Overridden on the token-expiry failure path so we never claim success while
  // signing out.
  const [message, setMessage] = useState('Waiting for authentication...')

  // Handles redirect when middleware detects token expiry
  useEffect(() => {
    const doLogOut = async () => {
      logout();
    }

    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");

    if (auth === "failed") {
      setMessage('Signing you out...')
      sessionStorage.setItem("tokenExpired", "true");
      doLogOut();
    }
  }, [])

  useEffect(() => {
    if (!isInitializing) {
      router.push(authenticated ? '/' : '/login')
    }
  }, [authenticated, isInitializing, router])

  return (
    <div style={containerStyle}>
      <p>{message}</p>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1rem',
  color: '#555',
}

// Template page from @tidecloak/nextjs; needs a provisioned tidecloak.json (NEXT_PUBLIC_TIDE_MODE=live).
export default function AuthRedirectPage() {
  return <LiveOnly><RedirectPage /></LiveOnly>
}
