const { hash, keys, redis } = require('../lib/store')

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const [records, lastSync] = await Promise.all([hash(keys.alerts), redis('GET', keys.sync)])
    const alerts = Object.values(records).map(JSON.parse).sort((a, b) => b.date.localeCompare(a.date))
    res.setHeader('Cache-Control', 'no-store')
    res.json({ alerts, lastSync, pushKey: process.env.VAPID_PUBLIC_KEY || null })
  } catch {
    res.status(503).json({ error: 'Archiwum jest chwilowo niedostępne.' })
  }
}
