import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

type State =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'already' }
  | { kind: 'invalid' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export const Route = createFileRoute('/unsubscribe')({
  head: () => ({
    meta: [
      { title: 'Unsubscribe — RestPilot AI' },
      { name: 'description', content: 'Manage your RestPilot AI email preferences.' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null

  useEffect(() => {
    if (!token) {
      setState({ kind: 'invalid' })
      return
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) setState({ kind: 'ready' })
        else if (data.reason === 'already_unsubscribed') setState({ kind: 'already' })
        else setState({ kind: 'invalid' })
      })
      .catch(() => setState({ kind: 'invalid' }))
  }, [token])

  async function confirm() {
    if (!token) return
    setState({ kind: 'submitting' })
    try {
      const res = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (data.success) setState({ kind: 'done' })
      else if (data.reason === 'already_unsubscribed') setState({ kind: 'already' })
      else setState({ kind: 'error', message: data.error || 'Something went wrong.' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' })
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="font-serif text-3xl italic text-foreground">RestPilot AI</h1>
      <div className="mt-8 w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
        {state.kind === 'loading' && <p className="text-sm text-muted-foreground">Checking your link…</p>}
        {state.kind === 'invalid' && (
          <p className="text-sm text-muted-foreground">
            This unsubscribe link is invalid or has expired.
          </p>
        )}
        {state.kind === 'already' && (
          <p className="text-sm text-muted-foreground">
            You're already unsubscribed. You won't receive further emails.
          </p>
        )}
        {state.kind === 'ready' && (
          <>
            <p className="text-sm text-foreground">
              Confirm you want to unsubscribe from RestPilot AI emails. You'll still receive
              essential account and billing emails.
            </p>
            <button
              onClick={confirm}
              className="mt-6 h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
            >
              Unsubscribe
            </button>
          </>
        )}
        {state.kind === 'submitting' && <p className="text-sm text-muted-foreground">Processing…</p>}
        {state.kind === 'done' && (
          <p className="text-sm text-foreground">You've been unsubscribed. Sorry to see you go.</p>
        )}
        {state.kind === 'error' && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </div>
    </main>
  )
}
