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

export function formatKESCompact(value) {
  const num = Number(value) || 0
  return kesCompactFormatter.format(num)
}

export function formatKES(value) {
  const num = Number(value) || 0
  return kesStandardFormatter.format(num)
}

export default { formatKES, formatKESCompact }


