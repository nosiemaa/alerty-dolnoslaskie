const day = 86_400_000
const warsaw = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'
})

function cutoffDate(now = Date.now(), days = 5) {
  const today = warsaw.format(new Date(now))
  return new Date(Date.parse(today) - (days - 1) * day).toISOString().slice(0, 10)
}

module.exports = { cutoffDate }
