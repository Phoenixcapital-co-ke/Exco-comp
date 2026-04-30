import { API_URLS } from './api.js'
import { normalizeZidishaResponse } from './normalizeZidishaResponse.js'

export async function fetchAllZidishaRows({ signal, pageSize = 2000, product, products, branch, excludeBranch, excludeClientIds, month, year } = {}) {
  const results = []
  let page = 1
  let total = Infinity

  while ((page - 1) * pageSize < total) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    
    // Add filtering parameters if provided
    if (product) {
      params.append('product', product)
    }
    if (products && Array.isArray(products) && products.length > 0) {
      params.append('products', products.join(','))
    }
    if (branch) {
      params.append('branch', branch)
    }
    if (excludeBranch) {
      params.append('excludeBranch', excludeBranch)
    }
    if (excludeClientIds && Array.isArray(excludeClientIds) && excludeClientIds.length > 0) {
      params.append('excludeClientIds', excludeClientIds.join(','))
    }
    // Add date filtering for better performance
    if (month && month >= 1 && month <= 12) {
      params.append('month', String(month))
    }
    if (year && year >= 2000 && year <= 2100) {
      params.append('year', String(year))
    }
    if (typeof arguments[0]?.dateField === 'string' && arguments[0].dateField.trim()) {
      params.append('dateField', String(arguments[0].dateField).trim())
    }
    
    const res = await fetch(`${API_URLS.zidisha.data}?${params.toString()}`, {
      credentials: 'include',
      signal,
    })
    if (!res.ok) {
      let details = ''
      try {
        const body = await res.json()
        if (body && typeof body.error === 'string' && body.error.trim()) {
          details = body.error.trim()
        }
      } catch {
        // ignore
      }
      throw new Error(details ? `${details} (${res.status})` : `Failed to load data (${res.status})`)
    }
    const payload = await res.json()
    const rows = normalizeZidishaResponse(payload)
    results.push(...rows)

    const metaTotal = Number(payload?.meta?.total)
    if (Number.isFinite(metaTotal) && metaTotal >= 0) {
      total = metaTotal
    } else if (rows.length < pageSize) {
      break
    }

    if (rows.length < pageSize) {
      break
    }

    page += 1
  }

  return results
}


