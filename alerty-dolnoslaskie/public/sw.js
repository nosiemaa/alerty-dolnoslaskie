self.addEventListener('push', event => {
  if (!event.data) return
  const alert = event.data.json()
  event.waitUntil(self.registration.showNotification(alert.title, {
    body: alert.body,
    tag: alert.id,
    icon: '/icon-192.png',
    data: { source: alert.source }
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const source = new URL(event.notification.data?.source || '/', self.location.origin)
  const official = source.origin === 'https://www.gov.pl' && source.pathname.startsWith('/web/rcb/')
  event.waitUntil(self.clients.openWindow(official ? source.href : '/'))
})
