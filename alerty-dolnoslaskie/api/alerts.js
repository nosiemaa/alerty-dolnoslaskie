const { records, store } = require('../lib/store')

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const [archive, lastSync] = await Promise.all([records('alerts'), store('last_sync')])
    const alerts = Object.values(archive).sort((a, b) => b.date.localeCompare(a.date))
    res.setHeader('Cache-Control', 'no-store')
    res.json({ alerts, lastSync, pushKey: process.env.VAPID_PUBLIC_KEY || null })
  } catch {
    res.status(503).json({ error: 'Archiwum jest chwilowo niedostępne.' })
  }
}
