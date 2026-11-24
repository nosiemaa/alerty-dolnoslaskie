const { ECDH } = require('node:crypto')
const { write, remove, digest } = require('../lib/store')

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
      await remove('subscriptions', id)
    } else {
      const { auth, p256dh } = req.body.keys || {}
      if (!/^[\w-]{22}$/.test(auth || '') || !/^[\w-]{87}$/.test(p256dh || '')) return res.status(400).end()
      try {
        ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1')
      } catch {
        return res.status(400).end()
      }
      await write('subscriptions', id, { ...subscription, keys: { auth, p256dh } })
    }
    res.status(204).end()
  } catch {
    res.status(503).end()
  }
}
