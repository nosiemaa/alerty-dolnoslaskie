const assert = require('node:assert/strict')
const { test } = require('node:test')
const { links, parseAlert } = require('../lib/source')

const url = 'https://www.gov.pl/web/rcb/alert-rcb-przyklad'

function article(title, coverage, footer = '') {
  return `<main><h1>${title}</h1><p>06.10.2025</p><p>${coverage}</p></main><footer>${footer}</footer>`
}

test('odczytuje linki do komunikatów RCB i usuwa duplikaty', () => {
  assert.deepEqual(links(`
    <a href="/web/rcb/alert-rcb-przyklad">Alert RCB – woda</a>
    <a href="${url}#sekcja">Alert RCB - woda</a>
    <a href="https://example.org/web/rcb/fake">Alert RCB - woda</a>
    <a href="/web/rcb/alertrcb">Alert RCB</a>
  `), [url])
})

test('dopasowuje województwo, lokalny powiat i zasięg krajowy', () => {
  const title = 'Alert RCB - test'
  for (const coverage of [
    'Wysłano do odbiorców na terenie woj. dolnośląskiego.',
    'Alert wysłano na terenie powiatu kłodzkiego.',
    'Wysłano na terenie całego kraju.'
  ]) assert.deepEqual(parseAlert(article(title, coverage), url), { title, date: '2025-10-06', source: url })
})

test('pomija inny region i tekst poza artykułem', () => {
  assert.equal(parseAlert(article('Alert RCB - test', 'Alert wysłano w woj. lubelskim.', 'woj. dolnośląskie'), url), null)
})
