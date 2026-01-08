import { API_URLS } from './api.js'
import { normalizeZidishaResponse } from './normalizeZidishaResponse.js'

export async function fetchAllZidishaRows({ signal, pageSize = 5000, product, products, branch, excludeBranch } = {}) {
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
    
    const res = await fetch(`${API_URLS.zidisha.data}?${params.toString()}`, {
      credentials: 'include',
      signal,
    })
    if (!res.ok) {
      throw new Error(`Failed to load data (${res.status})`)
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


