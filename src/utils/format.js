// Currency formatting helpers for KSh (KES)

const kesCompactFormatter = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const kesStandardFormatter = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  maximumFractionDigits: 0,
})

const currencyFormatterCache = new Map()

function getCurrencyFormatter(currency, opts = {}) {
  const ccy = String(currency || 'KES').toUpperCase()
  const maximumFractionDigits =
    typeof opts.maximumFractionDigits === 'number' ? opts.maximumFractionDigits : 0
  const notation = opts.notation || 'standard'
  const key = `${ccy}|${notation}|${maximumFractionDigits}`
  if (currencyFormatterCache.has(key)) return currencyFormatterCache.get(key)

  // Use a neutral locale to avoid forcing Kenyan shilling formatting for other currencies
  const fmt = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: ccy,
    notation,
    maximumFractionDigits,
  })
  currencyFormatterCache.set(key, fmt)
  return fmt
}

export function formatCurrency(value, currency = 'KES', opts = {}) {
  const num = Number(value) || 0
  return getCurrencyFormatter(currency, opts).format(num)
}

export function formatKESCompact(value) {
  const num = Number(value) || 0
  return kesCompactFormatter.format(num)
}

export function formatKES(value) {
  const num = Number(value) || 0
  return kesStandardFormatter.format(num)
}

export default { formatKES, formatKESCompact, formatCurrency }


