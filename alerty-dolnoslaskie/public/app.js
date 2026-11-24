const list = document.querySelector('#alerts')
const status = document.querySelector('#sync-status')
const pushStatus = document.querySelector('#push-status')
const toggle = document.querySelector('#push-toggle')
const testButton = document.querySelector('#push-test')
const pushMenu = document.querySelector('#push-menu')
const pushDialog = document.querySelector('#push-dialog')
const refresh = document.querySelector('#refresh')
const more = document.querySelector('#more')
const dateFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' })
const timeFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' })
let alerts = []
let visible = 20
let applicationKey
let registration
let enabled = false
let loading = false
let lastFeed = ''

pushMenu.addEventListener('click', () => pushDialog.showModal())
pushDialog.addEventListener('click', event => {
  if (event.target !== pushDialog) return
  const bounds = pushDialog.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) pushDialog.close()
})

function render() {
  list.replaceChildren(...alerts.slice(0, visible).map(alert => {
    const item = document.createElement('li')
    item.className = 'alert'
    const time = document.createElement('time')
    time.dateTime = alert.date
    time.textContent = dateFormat.format(new Date(alert.date + 'T12:00:00Z'))
    const system = document.createElement('span')
    system.textContent = alert.system === 'RSO' ? 'RSO · ' : 'RCB · '
    const title = document.createElement('h3')
    title.textContent = alert.title
    const source = document.createElement('a')
    source.href = alert.source
    source.textContent = 'Źródło'
    source.setAttribute('aria-label', 'Źródło — ' + alert.title)
    item.append(system, time, title, source)
    return item
  }))
  more.hidden = visible >= alerts.length
}

async function loadAlerts() {
  if (loading) return
  loading = true
  refresh.disabled = true
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch('/api/alerts', { signal: controller.signal })
    if (!response.ok) throw new Error()
    const data = await response.json()
    applicationKey = data.pushKey
    const syncTime = Date.parse(data.lastSync)
    status.textContent = !data.lastSync ? 'Czekam na pierwszą synchronizację.'
      : `${data.alerts.length ? data.alerts.length + ' alertów' : 'Brak alertów z ostatnich 5 dni'} · Sprawdzono ${timeFormat.format(syncTime)}`
    if (Number.isFinite(syncTime) && Date.now() - syncTime > 5 * 60_000) {
      status.textContent += ' · Synchronizacja opóźniona'
    }
    const feed = JSON.stringify(data.alerts)
    if (feed !== lastFeed) {
      alerts = data.alerts
      lastFeed = feed
      render()
    }
  } catch {
    status.textContent = alerts.length ? 'Nie udało się odświeżyć zapisanej listy.' : 'Nie udało się pobrać alertów. Spróbuj ponownie.'
  } finally {
    clearTimeout(timeout)
    loading = false
    refresh.disabled = false
  }
}

async function setupPush() {
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (appleMobile && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) {
    pushStatus.textContent = 'Na iPhonie lub iPadzie dodaj stronę do ekranu początkowego i otwórz ją z ikony.'
    return
  }
  if (!registration || !('PushManager' in window) || !('Notification' in window)) {
    pushStatus.textContent = 'Powiadomienia są niedostępne w tej przeglądarce.'
    return
  }
  if (!applicationKey) {
    pushStatus.textContent = 'Powiadomienia są chwilowo niedostępne.'
    return
  }
  if (Notification.permission === 'denied') {
    pushStatus.textContent = 'Zmień uprawnienia do powiadomień w ustawieniach przeglądarki lub telefonu.'
    return
  }
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    await saveSubscription('POST', existing)
    enabled = true
  }
  updateToggle()
}

function updateToggle() {
  toggle.disabled = false
  toggle.textContent = enabled ? 'Wyłącz powiadomienia' : 'Włącz powiadomienia'
  testButton.hidden = !enabled
  pushStatus.textContent = enabled ? 'Powiadomienia są włączone na tym urządzeniu.'
    : 'Otrzymuj powiadomienia o nowych publikacjach także po zamknięciu aplikacji.'
}

testButton.addEventListener('click', async () => {
  testButton.disabled = true
  toggle.disabled = true
  try {
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      enabled = false
      updateToggle()
      throw new Error('Włącz powiadomienia, żeby wysłać test.')
    }
    const response = await fetch('/api/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), action: 'test' })
    })
    if (response.status === 429) throw new Error('Odczekaj minutę przed kolejnym testem.')
    if (response.status === 410) {
      await subscription.unsubscribe()
      enabled = false
      updateToggle()
      throw new Error('Subskrypcja wygasła. Włącz powiadomienia ponownie.')
    }
    if (!response.ok) throw new Error('Test się nie udał. Odśwież stronę i spróbuj ponownie.')
    pushStatus.textContent = 'Wysłano test. Sprawdź powiadomienia telefonu.'
  } catch (error) {
    pushStatus.textContent = error.message
  } finally {
    testButton.disabled = false
    toggle.disabled = false
  }
})

async function saveSubscription(method, subscription) {
  const response = await fetch('/api/subscription', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription)
  })
  if (!response.ok) throw new Error('Nie udało się zapisać ustawień powiadomień.')
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true
  try {
    if (enabled) {
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await saveSubscription('DELETE', subscription)
        await subscription.unsubscribe()
      }
      enabled = false
    } else {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Zezwól na powiadomienia w ustawieniach urządzenia.')
      const existing = await registration.pushManager.getSubscription()
      const rawKey = atob(applicationKey.replace(/-/g, '+').replace(/_/g, '/'))
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: Uint8Array.from(rawKey, char => char.charCodeAt(0))
      })
      await saveSubscription('POST', subscription)
      enabled = true
    }
    updateToggle()
  } catch (error) {
    pushStatus.textContent = error.message || 'Nie udało się zmienić ustawień powiadomień.'
    toggle.disabled = false
  }
})

more.addEventListener('click', () => { visible += 20; render() })
refresh.addEventListener('click', loadAlerts)
setInterval(() => {
  if (!document.hidden) loadAlerts()
}, 20_000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadAlerts()
})
window.addEventListener('online', loadAlerts)

const worker = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null)
Promise.all([loadAlerts(), worker]).then(async ([, ready]) => {
  registration = ready
  await setupPush()
}).catch(() => {
  pushStatus.textContent = 'Nie udało się sprawdzić ustawień powiadomień. Odśwież stronę.'
})
