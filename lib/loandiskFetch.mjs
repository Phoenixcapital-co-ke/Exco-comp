/**
 * Fetch loans from Loandisk advanced_search_loans (shared by server + scripts).
 */
const LOANDISK_BASE_URL = process.env.LOANDISK_BASE_URL || 'https://api-main.loandisk.com/7125'
const LOANDISK_AUTH = process.env.LOANDISK_AUTH || 'Basic hM2PPcacbMJPKsE4mAM3hbYNqbY5vSJtjrKYHRad'
const LOANDISK_PAGE_SIZE = Number(process.env.LOANDISK_PAGE_SIZE || 20)
const FETCH_TIMEOUT_MS = Number(process.env.LOANDISK_FETCH_TIMEOUT_MS || 120000)
const MAX_PAGE_ATTEMPTS = 5

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** @returns {Promise<{ loans: object[], fetched: number, totalResults: number }>} */
export async function fetchLoandiskLoans(branchCode, loanStatusId) {
  const branchCodeClean = String(branchCode ?? '').trim()
  if (!branchCodeClean) throw new Error('Missing branch code')

  const url = `${LOANDISK_BASE_URL}/${encodeURIComponent(branchCodeClean)}/advanced_search_loans`
  let page = 1
  let fetched = 0
  let totalResults = 0
  const allLoans = []

  for (;;) {
    const payload = { from: page, count: LOANDISK_PAGE_SIZE, loan_status_id: loanStatusId }
    let results = []
    let pageSucceeded = false

    for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
      try {
        const resp = await fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            Authorization: LOANDISK_AUTH,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const json = await resp.json()
        if (json?.error) {
          throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error))
        }
        const response = json?.response || {}
        const rawResults = Array.isArray(response.Results) ? response.Results : []
        results = Array.isArray(rawResults[0]) ? rawResults.flat() : rawResults
        if (typeof response.TotalResults === 'number') totalResults = response.TotalResults
        pageSucceeded = true
        break
      } catch (err) {
        if (attempt === MAX_PAGE_ATTEMPTS) throw err
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 15000)))
      }
    }

    if (!pageSucceeded) throw new Error(`Failed page ${page} for branch ${branchCodeClean}`)

    for (const item of results) allLoans.push(item)
    fetched += results.length
    if (results.length < LOANDISK_PAGE_SIZE) break
    page += 1
    if (totalResults && fetched >= totalResults) break
    if (page > 500) break
    await new Promise((r) => setTimeout(r, 100))
  }

  return { loans: allLoans, fetched, totalResults }
}
