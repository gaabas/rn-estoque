import { useEffect, useState } from 'react'

export function usePwaUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

    const serviceWorker = navigator.serviceWorker
    let registration: ServiceWorkerRegistration | undefined
    let installing: ServiceWorker | null = null
    let disposed = false
    const refresh = () => setWaiting(serviceWorker.controller ? registration?.waiting ?? null : null)
    const observeInstallation = () => {
      installing?.removeEventListener('statechange', refresh)
      installing = registration?.installing ?? null
      installing?.addEventListener('statechange', refresh)
      refresh()
    }
    const check = () => {
      if (document.visibilityState === 'visible') {
        void registration?.update().catch(() => undefined)
      }
    }

    serviceWorker.addEventListener('controllerchange', refresh)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    void serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(result => {
      if (disposed) return
      registration = result
      registration.addEventListener('updatefound', observeInstallation)
      observeInstallation()
    }).catch(error => {
      console.warn('Cache da interface indisponível.', error)
    })

    return () => {
      disposed = true
      registration?.removeEventListener('updatefound', observeInstallation)
      installing?.removeEventListener('statechange', refresh)
      serviceWorker.removeEventListener('controllerchange', refresh)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [])

  if (!waiting) return null
  return () => {
    if (waiting.state !== 'installed') {
      window.location.reload()
      return
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting.postMessage('activate-update')
  }
}
