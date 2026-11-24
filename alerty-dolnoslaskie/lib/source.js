const { load } = require('cheerio')

const base = 'https://www.gov.pl'
const home = base + '/web/rcb/'
const sitemap = home + 'mapa-strony'
const normalize = value => value.replace(/\s+/g, ' ').trim()
const alertTitle = /^(?:odwołanie\s+)?alert(?:u)?\s+rcb\s*[-–—:]/i
const region = /\bdolnośląsk\p{L}*|\bdolnego śląska\b|\b(?:w całej polsce|na terenie całego kraju|na obszarze całego kraju)\b/iu
const local = /\b(?:wrocławsk|kłodzk|karkonosk|zgorzeleck|oławsk|lubińsk|kamiennogórsk|wołowsk|trzebnick|oleśnick|ząbkowick|dzierżoniowsk|strzelińsk|milick|lubańsk|lwóweck|złotoryjsk|jaworsk|legnick|głogowsk|górowsk|polkowick|bolesławieck|wałbrzysk)\p{L}*|(?:\b(?:wrocław|wałbrzych|legnic)\p{L}*|\bjeleni(?:a|ej|ą) gór\p{L}*|\b(?:jordanów|jordanowa) śląsk\p{L}*|\bbogatyni\p{L}*)/iu

async function download(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(7000) })
  if (!response.ok) throw new Error(`Gov.pl HTTP ${response.status}`)
  return response.text()
}

function links(html) {
  const $ = load(html)
  const urls = new Set()
  $('a[href]').each((_, link) => {
    if (!alertTitle.test(normalize($(link).text()))) return
    try {
      const url = new URL($(link).attr('href'), home)
      if (url.origin === base && /^\/web\/rcb\/[^/]+\/?$/.test(url.pathname)) {
        urls.add(base + url.pathname.replace(/\/$/, ''))
      }
    } catch {
      // Pomijamy błędny link z indeksu.
    }
  })
  return [...urls]
}

function parseAlert(html, url) {
  const $ = load(html)
  const titleNode = $('h1, h2').filter((_, element) => alertTitle.test(normalize($(element).text()))).first()
  const title = normalize(titleNode.text())
  const main = $('main').first()
  if (!title || !main.length) throw new Error('Nie rozpoznano układu komunikatu RCB')
  main.find('script, style').remove()
  const textNodes = main.find('*').contents().filter((_, node) => node.type === 'text').map((_, node) => node.data).get()
  const day = textNodes.join(' ').match(/\b(\d{2})\.(\d{2})\.(20\d{2})\b/)
  if (!day) return null
  const date = `${day[3]}-${day[2]}-${day[1]}`
  const paragraphs = main.find('p, li').map((_, item) => normalize($(item).text())).get().filter(Boolean)
  const coverage = paragraphs.filter(text => /wysłan|odbiorc|obejmuje|powiat|województw|\bwoj\./iu.test(text) || region.test(text))
  const scope = [title, ...coverage].join(' ')
  if (!region.test(scope) && !local.test(scope)) return null
  return { title, date, source: url }
}

module.exports = { home, sitemap, links, parseAlert, download }
