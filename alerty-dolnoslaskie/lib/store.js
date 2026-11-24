const { createHash } = require('node:crypto')

const prefix = 'rcb-dolnoslaskie:v1:'
const keys = Object.fromEntries(
  ['checked', 'alerts', 'subscriptions', 'pending', 'sync', 'lock'].map(name => [name, prefix + name])
)

const digest = value => createHash('sha256').update(value).digest('hex')

async function redis(...command) {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env
  if (!url || !token) throw new Error('Brak konfiguracji Redis')
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`)
  const { result, error } = await response.json()
  if (error) throw new Error('Polecenie Redis nie powiodło się')
  return result
}

async function hash(key) {
  const pairs = await redis('HGETALL', key)
  return Object.fromEntries(Array.from({ length: pairs.length / 2 }, (_, i) => [pairs[2 * i], pairs[2 * i + 1]]))
}

module.exports = { redis, hash, keys, digest }
