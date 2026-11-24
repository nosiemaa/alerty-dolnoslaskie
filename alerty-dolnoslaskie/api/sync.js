const { randomUUID, timingSafeEqual } = require('node:crypto')
const push = require('web-push')
const { store, records, write, remove, digest } = require('../lib/store')
const { home, sitemap, download, links, parseAlert } = require('../lib/source')
const { getRso } = require('../lib/rso')
const { cutoffDate } = require('../lib/retention')

const day = 86_400_000

async function discover(deadline, cutoff) {
  const sources = await Promise.allSettled([download(home), download(sitemap)])
  const recent = sources[0].status === 'fulfilled' ? links(sources[0].value) : []
  const archive = sources[1].status === 'fulfilled' ? links(sources[1].value).reverse() : []
  if (!recent.length && !archive.length) throw new Error('Nie udało się odczytać indeksu RCB')
  const checked = await records('checked')
  const now = Date.now()
  const urls = [...new Set([...recent, ...archive])]
  const unvisited = urls.filter(url => !checked[digest(url)])
  const retry = urls.filter(url => {
    const attempt = Number(checked[digest(url)])
    return attempt < 0 && now + attempt > 60 * 60_000
  })
  const batch = [...unvisited, ...retry].slice(0, 26)
  const revisits = recent.filter(url => checked[digest(url)] && now - Number(checked[digest(url)]) > 60 * 60_000)
  batch.unshift(...revisits.slice(0, 6))
  let failed = 0
  for (let start = 0; start < batch.length && Date.now() < deadline; start += 8) {
    const results = await Promise.allSettled(batch.slice(start, start + 8).map(async url => {
      const id = digest(url)
      let alert
      try {
        alert = parseAlert(await download(url), url)
      } catch (error) {
        await write('checked', id, -now)
        throw error
      }
      await saveAlert(id, alert?.date >= cutoff ? alert : null, now)
    }))
    failed += results.filter(result => result.status === 'rejected').length
  }
  if (failed === batch.length && failed) throw new Error('Nie udało się odczytać komunikatów RCB')
  return { candidates: urls.length, failed, partial: sources.some(result => result.status === 'rejected') }
}

function saveAlert(id, alert, now) {
  const pending = alert?.date >= cutoffDate(now, 2) && alert.date <= cutoffDate(now)
    ? { ...alert, expires: now + day } : null
  return store('save_alert', { id, alert, pending, now })
}

async function discoverRso(cutoff, deadline) {
  const alerts = await getRso(cutoff, deadline)
  const now = Date.now()
  for (let start = 0; start < alerts.length; start += 8) {
    if (Date.now() >= deadline) throw new Error('Nie udało się zapisać wszystkich komunikatów RSO')
    await Promise.all(alerts.slice(start, start + 8).map(alert =>
      saveAlert(digest(alert.source), alert, now)))
  }
  return alerts.length
}

async function deleteExpired(cutoff) {
  const archive = await records('alerts')
  const expired = Object.keys(archive).filter(id => archive[id].date < cutoff)
  for (let start = 0; start < expired.length; start += 8) {
    await Promise.all(expired.slice(start, start + 8).map(id => remove('alerts', id)))
  }
  return expired.length
}

async function sendPending(deadline, cutoff) {
  const pending = await records('pending')
  if (!Object.keys(pending).length) return 0
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  push.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const subscriptions = Object.entries(await records('subscriptions'))
  let sent = 0
  for (const [id, alert] of Object.entries(pending)) {
    if (Date.now() >= deadline) break
    if (Date.now() >= alert.expires || alert.date < cutoff) {
      await store('finish_alert', { id })
      continue
    }
    const sentGroup = 'sent:' + id
    const delivered = await records(sentGroup)
    const remaining = subscriptions.filter(([subscriber]) => !delivered[subscriber])
    let complete = true
    for (let start = 0; start < remaining.length; start += 15) {
      if (Date.now() >= deadline) {
        complete = false
        break
      }
      const failures = await Promise.allSettled(remaining.slice(start, start + 15).map(async ([subscriber, value]) => {
        try {
          await push.sendNotification(value, JSON.stringify({
            id, title: alert.system === 'RSO' ? 'Nowy komunikat RSO' : 'Nowy Alert RCB',
            body: alert.title, source: alert.source
          }), { TTL: 3600, topic: id.slice(0, 32), timeout: 4500 })
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            await remove('subscriptions', subscriber)
            return
          }
          throw error
        }
        await write(sentGroup, subscriber, true)
        sent++
      }))
      if (failures.some(result => result.status === 'rejected')) complete = false
    }
    if (complete) await store('finish_alert', { id })
  }
  return sent
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end()
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.CRON_SECRET
  const received = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from('Bearer ' + secret)
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).end()
  const lock = randomUUID()
  const started = Date.now()
  try {
    if (!await store('lock', { token: lock })) return res.json({ busy: true })
    try {
      const cutoff = cutoffDate(started)
      const [rcb, rso, cleanup] = await Promise.allSettled([
        discover(started + 27_000, cutoff),
        discoverRso(cutoff, started + 27_000),
        deleteExpired(cutoff)
      ])
      const sent = await sendPending(started + 45_000, cutoff)
      if (rcb.status === 'fulfilled' || rso.status === 'fulfilled') {
        await write('sync', 'last', new Date().toISOString())
      }
      const failure = [rcb, rso, cleanup].find(result => result.status === 'rejected')
      if (failure) throw failure.reason
      res.json({ rcb: rcb.value, rso: rso.value, removed: cleanup.value, sent })
    } finally {
      await store('unlock', { token: lock })
    }
  } catch (error) {
    console.error('Synchronizacja RCB:', error.message)
    if (!res.headersSent) res.status(503).json({ error: 'Synchronizacja nie powiodła się.' })
  }
}
