// Fetch GPSIoT clients and assets from GPSIoT API and persist into SQLite
// Usage: node scripts/fetch_gpsiot_clients.mjs
//
// This script:
// 1) Signs in to obtain an access_token
// 2) Uses the token to call GetAllClients
// 3) Saves the client list into table: white_label
// 4) For each client, fetches assets via GetAllAssets
// 5) Saves assets into table: Whitelabel_devices

import Database from 'better-sqlite3'
import fetch from 'node-fetch'

const TOKEN_URL = 'https://api.gpsiot.net/token'
const CLIENTS_URL = 'https://api.gpsiot.net/api/Client/GetAllClients'
const ASSETS_URL = 'https://api.gpsiot.net/api/Asset/GetAllAssets'

// TODO: for production, move these into environment variables instead of hardcoding
const USERNAME = '0kznpeg7T1eZNJXYgRULEr43IAsr2QK1wdWM'
const PASSWORD = 'zTLfD0E8Rq7HwWTY6wMJurKG'

function createDb() {
  const db = new Database('data/app.db')
  db.exec(`
    CREATE TABLE IF NOT EXISTS white_label (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      company_name TEXT,
      reseller_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      raw_json TEXT
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS Whitelabel_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT,
      client_id TEXT,
      name TEXT,
      colour TEXT,
      make TEXT,
      model TEXT,
      tracker_type INTEGER,
      status INTEGER,
      owner_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      raw_json TEXT
    );
  `)
  return db
}

async function getToken() {
  const params = new URLSearchParams()
  params.append('username', USERNAME)
  params.append('password', PASSWORD)
  params.append('grant_type', 'password')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`Failed to parse token JSON. HTTP ${res.status}. Body: ${text}`)
  }

  if (!json.access_token) {
    throw new Error(`Token request failed: ${json.error || JSON.stringify(json)}`)
  }

  return json.access_token
}

async function fetchClients(token) {
  const res = await fetch(CLIENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  const text = await res.text()
  const trimmed = (text || '').trim()
  if (!trimmed) {
    console.log('[GPSIOT] GetAllClients returned empty body (treating as no clients).')
    return []
  }

  let json
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    console.error('[GPSIOT] Raw clients response (first 400 chars):', trimmed.slice(0, 400))
    throw new Error(`Failed to parse clients JSON. HTTP ${res.status}.`)
  }

  const clients = json?.client
  if (!Array.isArray(clients)) {
    return []
  }
  return clients
}

function saveClients(db, clients) {
  if (!clients.length) {
    console.log('No clients returned from API.')
    return
  }

  const insert = db.prepare(`
    INSERT INTO white_label (
      client_id,
      company_name,
      reseller_name,
      raw_json,
      updated_at
    ) VALUES (
      @client_id,
      @company_name,
      @reseller_name,
      @raw_json,
      CURRENT_TIMESTAMP
    )
  `)

  const clear = db.prepare('DELETE FROM white_label')

  const tx = db.transaction((rows) => {
    clear.run()
    for (const c of rows) {
      const payload = {
        client_id: c.ClientId || null,
        company_name: c.vCompanyName || null,
        reseller_name: c.ResellerName || null,
        raw_json: JSON.stringify(c),
      }
      insert.run(payload)
    }
  })

  tx(clients)
  console.log(`Saved ${clients.length} clients into white_label`)
}

async function fetchAssets(token, clientId) {
  const res = await fetch(ASSETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ClientID: clientId }),
  })

  const text = await res.text()
  const trimmed = (text || '').trim()
  if (!trimmed) {
    return []
  }

  let json
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    console.error(`[GPSIOT] Failed to parse assets JSON for client ${clientId}. Response (first 400 chars):`, trimmed.slice(0, 400))
    return []
  }

  const assets = json?.Asset
  if (!Array.isArray(assets)) {
    return []
  }
  return assets
}

function saveAssets(db, assets, clientId) {
  if (!assets.length) {
    return
  }

  const insert = db.prepare(`
    INSERT INTO Whitelabel_devices (
      asset_id,
      client_id,
      name,
      colour,
      make,
      model,
      tracker_type,
      status,
      owner_id,
      raw_json,
      updated_at
    ) VALUES (
      @asset_id,
      @client_id,
      @name,
      @colour,
      @make,
      @model,
      @tracker_type,
      @status,
      @owner_id,
      @raw_json,
      CURRENT_TIMESTAMP
    )
  `)

  const tx = db.transaction((rows) => {
    for (const a of rows) {
      const payload = {
        asset_id: a.AssetId || null,
        client_id: clientId,
        name: a.Name || null,
        colour: a.Colour || null,
        make: a.Make || null,
        model: a.Model || null,
        tracker_type: a.TrackerType != null ? Number(a.TrackerType) : null,
        status: a.Status != null ? Number(a.Status) : null,
        owner_id: a.OwnerId || null,
        raw_json: JSON.stringify(a),
      }
      insert.run(payload)
    }
  })

  tx(assets)
}

async function main() {
  try {
    console.log('[GPSIOT] Getting access token...')
    const token = await getToken()
    console.log('[GPSIOT] Received token (truncated):', token.slice(0, 20) + '...')

    console.log('[GPSIOT] Fetching client list...')
    const clients = await fetchClients(token)
    console.log(`[GPSIOT] Fetched ${clients.length} clients`)

    const db = createDb()
    saveClients(db, clients)

    // Fetch assets for each client
    console.log('[GPSIOT] Fetching assets for each client...')
    const clearAssets = db.prepare('DELETE FROM Whitelabel_devices')
    clearAssets.run()
    
    let totalAssets = 0
    for (const client of clients) {
      const clientId = client.ClientId
      if (!clientId) continue
      
      try {
        const assets = await fetchAssets(token, clientId)
        if (assets.length > 0) {
          saveAssets(db, assets, clientId)
          totalAssets += assets.length
          console.log(`[GPSIOT] Fetched ${assets.length} assets for client ${client.vCompanyName || clientId}`)
        }
      } catch (e) {
        console.error(`[GPSIOT] Error fetching assets for client ${clientId}:`, e.message)
      }
    }
    
    console.log(`[GPSIOT] Saved ${totalAssets} total assets into Whitelabel_devices`)
    db.close()
    console.log('[GPSIOT] Done.')
    process.exit(0)
  } catch (e) {
    console.error('[GPSIOT] Error:', e.message)
    process.exit(1)
  }
}

main()

