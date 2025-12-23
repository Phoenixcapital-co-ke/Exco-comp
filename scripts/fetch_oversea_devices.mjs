// Fetch Oversea (Kajea) devices from Overseetracking API and persist into SQLite
// Usage: node scripts/fetch_oversea_devices.mjs
//
// This script:
// 1) Signs in to obtain a Token
// 2) Uses the Token to call GetMyTracker
// 3) Saves the tracker list into table: oversea_devices

import Database from 'better-sqlite3'
import fetch from 'node-fetch'
import FormData from 'form-data'

const API_URL = 'http://api.overseetracking.com/WebProcessorApi.ashx'
const LANGUAGE_TYPE = '2B72ABC6-19D7-4653-AAEE-0BE542026D46'

// TODO: for production, move these into environment variables instead of hardcoding
const USERNAME = 'GREGORY NYAMAO '
const PASSWORD = 'NYAMAO@3077'

function createDb() {
  const db = new Database('data/app.db')
  db.exec(`
    CREATE TABLE IF NOT EXISTS oversea_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT,
      system_no TEXT,
      model_id TEXT,
      model TEXT,
      imei TEXT,
      company_id TEXT,
      company_name TEXT,
      phone_number1 TEXT,
      object_id TEXT,
      name TEXT,
      owner_name TEXT,
      owner_phone TEXT,
      brand TEXT,
      type TEXT,
      activate_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      raw_json TEXT
    );
  `)
  return db
}

async function signIn() {
  const params = new URLSearchParams()
  params.append('Token', '')
  params.append('InformationType', 'User')
  params.append('OperationType', 'SignIn')
  params.append('LanguageType', LANGUAGE_TYPE)
  params.append(
    'Arguments',
    JSON.stringify({
      UserName: USERNAME,
      Password: PASSWORD,
    })
  )
  params.append(
    'PageArguments',
    JSON.stringify({
      PageSize: 1,
      PageIndex: 1,
    })
  )

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'http://www.overseetracking.com',
      Accept: '*/*',
    },
    body: params.toString(),
  })

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`Failed to parse sign-in JSON. HTTP ${res.status}. Body: ${text}`)
  }

  if (json.State !== '0') {
    throw new Error(`Sign-in failed: ${json.Error || 'Unknown error'}`)
  }
  if (!json.Token) {
    throw new Error('Sign-in response missing Token')
  }

  return json.Token
}

async function fetchDevices(token) {
  // Match the working Postman request exactly: application/x-www-form-urlencoded with these fields
  const params = new URLSearchParams()
  params.append('Token', token)
  params.append('InformationType', 'Product')
  params.append('OperationType', 'GetMyTracker')
  params.append('LanguageType', LANGUAGE_TYPE)
  params.append(
    'Arguments',
    JSON.stringify({
      TrackerType: '0',
    })
  )
  params.append(
    'PageArguments',
    JSON.stringify({
      PageSize: 1,
      PageIndex: 1,
    })
  )

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'http://www.overseetracking.com',
      Accept: '*/*',
    },
    body: params.toString(),
  })

  const text = await res.text()
  const trimmed = (text || '').trim()
  if (!trimmed) {
    console.log('[OVERSEA] GetMoreTracker returned empty body (treating as no devices).')
    return []
  }

  let json
  try {
    json = JSON.parse(trimmed)
  } catch (e) {
    console.error('[OVERSEA] Raw devices response (first 400 chars):', trimmed.slice(0, 400))
    throw new Error(`Failed to parse devices JSON. HTTP ${res.status}.`)
  }

  if (json.State !== '0') {
    throw new Error(`GetMyTracker failed: ${json.Error || 'Unknown error'}`)
  }

  const trackers = json?.Data?.Tracker
  if (!Array.isArray(trackers)) {
    return []
  }
  return trackers
}

function saveDevices(db, devices) {
  if (!devices.length) {
    console.log('No devices returned from API.')
    return
  }

  const insert = db.prepare(`
    INSERT INTO oversea_devices (
      product_id,
      system_no,
      model_id,
      model,
      imei,
      company_id,
      company_name,
      phone_number1,
      object_id,
      name,
      owner_name,
      owner_phone,
      brand,
      type,
      activate_time,
      raw_json,
      updated_at
    ) VALUES (
      @product_id,
      @system_no,
      @model_id,
      @model,
      @imei,
      @company_id,
      @company_name,
      @phone_number1,
      @object_id,
      @name,
      @owner_name,
      @owner_phone,
      @brand,
      @type,
      @activate_time,
      @raw_json,
      CURRENT_TIMESTAMP
    )
  `)

  const clear = db.prepare('DELETE FROM oversea_devices')

  const tx = db.transaction((rows) => {
    clear.run()
    for (const d of rows) {
      const payload = {
        product_id: d.ProductID || null,
        system_no: d.SystemNo || null,
        model_id: d.ModelID || null,
        model: d.Model || null,
        imei: d.IMEI || null,
        company_id: d.CompanyID || null,
        company_name: d.CompanyName || null,
        phone_number1: d.PhoneNumber1 || null,
        object_id: d.ObjectID || null,
        name: d.Name || null,
        owner_name: d.OwnerName || null,
        owner_phone: d.OwnerPhone || null,
        brand: d.Brand || null,
        type: d.Type || null,
        activate_time: d.ActivateTime || null,
        raw_json: JSON.stringify(d),
      }
      insert.run(payload)
    }
  })

  tx(devices)
  console.log(`Saved ${devices.length} devices into oversea_devices`)
}

async function main() {
  try {
    console.log('[OVERSEA] Signing in to Overseetracking...')
    const token = await signIn()
    console.log('[OVERSEA] Received token:', token)

    console.log('[OVERSEA] Fetching tracker list...')
    const devices = await fetchDevices(token)
    console.log(`[OVERSEA] Fetched ${devices.length} devices`)

    const db = createDb()
    saveDevices(db, devices)
    db.close()
    console.log('[OVERSEA] Done.')
    process.exit(0)
  } catch (e) {
    console.error('[OVERSEA] Error:', e.message)
    process.exit(1)
  }
}

main()


