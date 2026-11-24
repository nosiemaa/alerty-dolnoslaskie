const { randomUUID, timingSafeEqual } = require('node:crypto')
const push = require('web-push')
const { redis, hash, keys, digest } = require('../lib/store')
const { home, sitemap, download, links, parseAlert } = require('../lib/source')

const day = 86_400_000
const atomicSave = `
  if ARGV[2] ~= '' then
    local fresh = redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
    if fresh == 1 and ARGV[3] ~= '' then
      redis.call('HSET', KEYS[3], ARGV[1], ARGV[3])
    end
  end
  return redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
`

async function discover(deadline) {
  const sources = await Promise.allSettled([download(home), download(sitemap)])
  const recent = sources[0].status === 'fulfilled' ? links(sources[0].value) : []
  const archive = sources[1].status === 'fulfilled' ? links(sources[1].value).reverse() : []
  if (!recent.length && !archive.length) throw new Error('Nie udało się odczytać indeksu RCB')
  const checked = await hash(keys.checked)
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
        await redis('HSET', keys.checked, id, -now)
        throw error
      }
      const date = new Date(alert?.date + 'T00:00:00Z').getTime()
      const pending = alert && date >= now - 2 * day && date <= now + day
        ? JSON.stringify({ ...alert, expires: now + day }) : ''
      await redis('EVAL', atomicSave, 3, keys.checked, keys.alerts, keys.pending,
        id, alert ? JSON.stringify(alert) : '', pending, now)
    }))
    failed += results.filter(result => result.status === 'rejected').length
  }
  if (failed === batch.length && failed) throw new Error('Nie udało się odczytać komunikatów RCB')
  return { candidates: urls.length, failed, partial: sources.some(result => result.status === 'rejected') }
}

async function sendPending(deadline) {
  const pending = await hash(keys.pending)
  if (!Object.keys(pending).length) return 0
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  push.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const subscriptions = Object.entries(await hash(keys.subscriptions))
  let sent = 0
  for (const [id, record] of Object.entries(pending)) {
    if (Date.now() >= deadline) break
    const alert = JSON.parse(record)
    if (Date.now() >= alert.expires) {
      await redis('HDEL', keys.pending, id)
      continue
    }
    const sentKey = keys.pending + ':' + id
    const delivered = await hash(sentKey)
    const remaining = subscriptions.filter(([subscriber]) => !delivered[subscriber])
    let complete = true
    for (let start = 0; start < remaining.length; start += 15) {
      if (Date.now() >= deadline) {
        complete = false
        break
      }
      const failures = await Promise.allSettled(remaining.slice(start, start + 15).map(async ([subscriber, value]) => {
        try {
          await push.sendNotification(JSON.parse(value), JSON.stringify({
            id, title: 'Nowy Alert RCB', body: alert.title, source: alert.source
          }), { TTL: 3600, topic: id.slice(0, 32), timeout: 4500 })
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            await redis('HDEL', keys.subscriptions, subscriber)
            return
          }
          throw error
        }
        await redis('EVAL', "redis.call('HSET', KEYS[1], ARGV[1], '1'); return redis.call('EXPIRE', KEYS[1], 172800)", 1, sentKey, subscriber)
        sent++
      }))
      if (failures.some(result => result.status === 'rejected')) complete = false
    }
    if (complete) await redis('HDEL', keys.pending, id)
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
    if (await redis('SET', keys.lock, lock, 'NX', 'EX', 65) !== 'OK') return res.json({ busy: true })
    try {
      const discovery = await Promise.allSettled([discover(started + 27_000)])
      const sent = await sendPending(started + 45_000)
      if (discovery[0].status === 'rejected') throw discovery[0].reason
      await redis('SET', keys.sync, new Date().toISOString())
      res.json({ ...discovery[0].value, sent })
    } finally {
      await redis('EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end", 1, keys.lock, lock)
    }
  } catch (error) {
    console.error('Synchronizacja RCB:', error.message)
    if (!res.headersSent) res.status(503).json({ error: 'Synchronizacja nie powiodła się.' })
  }
}
