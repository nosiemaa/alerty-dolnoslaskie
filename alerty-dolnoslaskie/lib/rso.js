const { load } = require('cheerio')
const { download } = require('./source')

const origin = 'https://komunikaty.tvp.pl'
const listing = '/komunikaty/dolnoslaskie/wszystkie/'
const detail = /\/komunikaty\/[a-f\d]{24}\/detale\b/i

function parsePage(html) {
  const $ = load(html)
  const alerts = []
  let malformed = 0
  $('.card-body').each((_, element) => {
    const card = $(element)
    const title = card.find('h3').first().text().replace(/\s+/g, ' ').trim()
    const date = card.find('.message-date').text().match(/(\d{2})\.(\d{2})\.(\d{4})/)
    const path = card.find('[onclick]').map((_, button) => $(button).attr('onclick').match(detail)?.[0]).get()[0]
    if (!title && !date && !path) return
    if (!title || !date || !path) {
      malformed++
      return
    }
    alerts.push({ title, date: `${date[3]}-${date[2]}-${date[1]}`, source: origin + path, system: 'RSO' })
  })
  if (!$('form input[name="Search"]').length || malformed) throw new Error('Nie rozpoznano listy komunikatów RSO')
  const pages = $('.pagination a[href]').map((_, link) => {
    const path = $(link).attr('href').split('?')[0]
    return path.startsWith(listing) ? Number(path.slice(listing.length)) : 0
  }).get().filter(Number.isInteger)
  return { alerts, lastPage: Math.max(1, ...pages) }
}

async function getRso(cutoff, deadline) {
  const found = new Map()
  let lastPage = 1
  for (let page = 1; page <= lastPage; page++) {
    if (Date.now() >= deadline) throw new Error('Nie udało się pobrać wszystkich stron RSO')
    const url = new URL(listing + page, origin)
    url.searchParams.set('from', cutoff)
    const decoded = parsePage(await download(url.href))
    lastPage = Math.max(lastPage, decoded.lastPage)
    for (const alert of decoded.alerts) {
      if (alert.date >= cutoff) found.set(alert.source, alert)
    }
  }
  return [...found.values()]
}

module.exports = { getRso, parsePage }
