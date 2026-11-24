const { createHash } = require('node:crypto')

const digest = value => createHash('sha256').update(value).digest('hex')

async function store(operation, data = {}) {
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env
  if (!url || !key) throw new Error('Brak konfiguracji Supabase')
  const response = await fetch(new URL('/rest/v1/rpc/rcb_storage', url), {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, data }),
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`)
  return response.json()
}

const records = group => store('list', { group })
const write = (group, id, value) => store('write', { group, id, value })
const remove = (group, id) => store('remove', { group, id })

module.exports = { store, records, write, remove, digest }
