const { ECDH } = require('node:crypto')
const push = require('web-push')
const { records, write, remove, digest } = require('../lib/store')

async function sendTest(res, id, subscription) {
  const stored = (await records('subscriptions'))[id]
  if (!stored || stored.keys.auth !== subscription.keys.auth || stored.keys.p256dh !== subscription.keys.p256dh) {
    return res.status(404).end()
  }
  const testGroup = 'test:' + id
  const now = Date.now()
  const previous = (await records(testGroup)).last
  if (now - (previous || 0) < 60_000) return res.status(429).end()
  await write(testGroup, 'last', now)
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  try {
    await push.sendNotification(stored, JSON.stringify({
      id: 'test',
      title: 'Test powiadomienia',
      body: 'Powiadomienia z aplikacji Alerty RCB i RSO działają na tym urządzeniu.'
    }), {
      TTL: 60, topic: 'test', timeout: 4500,
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
    })
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await Promise.all([remove('subscriptions', id), remove(testGroup, 'last')])
      return res.status(410).end()
    }
    throw error
  }
  return res.status(204).end()
}

function subscriptionFrom(body) {
  const endpoint = body?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null
  try {
    const url = new URL(endpoint)
    const host = url.hostname
    const supported = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host)
      || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com')
    if (!supported || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.pathname === '/') return null
    return { endpoint: url.href }
  } catch {
    return null
  }
}

module.exports = async (req, res) => {
  if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).end()
  if (req.headers.origin !== `https://${req.headers.host}`) return res.status(403).end()
  const subscription = subscriptionFrom(req.body)
  if (!subscription) return res.status(400).end()
  const id = digest(subscription.endpoint)
  try {
    if (req.method === 'DELETE') {
      await Promise.all([remove('subscriptions', id), remove('test:' + id, 'last')])
    } else {
      const { auth, p256dh } = req.body.keys || {}
      if (!/^[\w-]{22}$/.test(auth || '') || !/^[\w-]{87}$/.test(p256dh || '')) return res.status(400).end()
      try {
        ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1')
      } catch {
        return res.status(400).end()
      }
      const device = { ...subscription, keys: { auth, p256dh } }
      if (req.body.action === 'test') return await sendTest(res, id, device)
      await write('subscriptions', id, device)
    }
    res.status(204).end()
  } catch {
    res.status(503).end()
  }
}
