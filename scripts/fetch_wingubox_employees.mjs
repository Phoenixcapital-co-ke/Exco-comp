// Fetch employees from Wingubox HRM API and persist into SQLite
// Usage: node scripts/fetch_wingubox_employees.mjs
//
// This script:
// 1) Gets a token from Wingubox API
// 2) Uses the token to fetch employees
// 3) Saves employee data into table: wingubox_employees

import Database from 'better-sqlite3'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const BASE_URL = 'https://api.wingubox.com/v1/hrm'

// Environment variables
const WINGUBOX_APP = process.env.WINGUBOX_APP || 'payroll(ke)'
const WINGUBOX_CONSUMER_KEY = process.env.WINGUBOX_CONSUMER_KEY
const WINGUBOX_CONSUMER_SECRET = process.env.WINGUBOX_CONSUMER_SECRET

if (!WINGUBOX_CONSUMER_KEY || !WINGUBOX_CONSUMER_SECRET) {
  console.error('❌ ERROR: WINGUBOX_CONSUMER_KEY and WINGUBOX_CONSUMER_SECRET must be set')
  process.exit(1)
}

function basicAuthHeader(key, secret) {
  const b64 = Buffer.from(`${key}:${secret}`).toString('base64')
  return `Basic ${b64}`
}

async function getToken({ app, consumerKey, consumerSecret }) {
  const url = `${BASE_URL}/token`

  // Wingubox API expects JSON body even for GET requests (non-standard but required)
  const res = await axios.get(url, {
    headers: {
      Authorization: basicAuthHeader(consumerKey, consumerSecret),
      'Wingubox-App': app,
      'Content-Type': 'application/json',
      Accept: '*/*',
    },
    // Wingubox expects JSON body even for GET
    data: { 'user-app': 'foobar' },
    timeout: 30000,
  })

  const token = res?.data?.results?.data?.token
  if (!token) {
    throw new Error(`Token not found. Response: ${JSON.stringify(res.data)}`)
  }
  return token
}

async function getEmployees({ app, token, employmentType = '%', employeeId, fields = 'personal-info' }) {
  const url = `${BASE_URL}/get-employees`

  const body = {
    'employment-type': employmentType,
    ...(employeeId ? { 'employee-id': Number(employeeId) } : {}),
    fields: fields,
  }

  // Wingubox expects JSON body even for GET
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Wingubox-App': app,
      'Content-Type': 'application/json',
      Accept: '*/*',
    },
    data: body,
    timeout: 30000,
  })

  return res.data
}

function createDb() {
  const db = new Database('data/app.db')
  
  // Drop existing table if it has raw_json column (migration)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(wingubox_employees)").all()
    const hasRawJson = tableInfo.some(col => col.name === 'raw_json')
    if (hasRawJson) {
      console.log('🔄 Migrating table: dropping old table structure...')
      db.exec('DROP TABLE IF EXISTS wingubox_employees')
    }
  } catch (e) {
    // Table might not exist yet, that's fine
  }
  
  // Create employees table with all fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS wingubox_employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE,
      employee_number TEXT,
      active TEXT,
      full_name TEXT,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      employment_type TEXT,
      job_title TEXT,
      department TEXT,
      department_code TEXT,
      region TEXT,
      region_code TEXT,
      contract_start TEXT,
      contract_end TEXT,
      residential_status TEXT,
      gender TEXT,
      date_of_birth TEXT,
      id_no TEXT,
      pin TEXT,
      telephone TEXT,
      official_email TEXT,
      personal_email TEXT,
      address_1 TEXT,
      address_2 TEXT,
      city TEXT,
      state_province_county TEXT,
      country TEXT,
      postal_code TEXT,
      zip_code TEXT,
      seen_in_last_sync INTEGER DEFAULT 0,
      last_seen_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // In-place migrations: add new columns when the table already exists.
  try {
    const tableInfo = db.prepare("PRAGMA table_info(wingubox_employees)").all()
    const hasSeen = tableInfo.some(col => col.name === 'seen_in_last_sync')
    const hasLastSeen = tableInfo.some(col => col.name === 'last_seen_at')
    if (!hasSeen) {
      db.exec(`ALTER TABLE wingubox_employees ADD COLUMN seen_in_last_sync INTEGER DEFAULT 0`)
    }
    if (!hasLastSeen) {
      db.exec(`ALTER TABLE wingubox_employees ADD COLUMN last_seen_at TEXT`)
    }
  } catch (e) {
    // ignore migration failures
  }

  // Create index on employee_id for faster lookups
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_wingubox_employees_employee_id ON wingubox_employees(employee_id)')
  } catch (e) {
    // Index might already exist
  }

  return db
}

// Helper function to normalize values (convert undefined/empty to null, ensure strings)
function normalizeValue(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object') return null // Objects should be handled separately
  return String(value).trim() || null
}

function insertOrUpdateEmployee(db, employeeData) {
  try {
    // Extract all fields from the employee data
    const employeeId = normalizeValue(employeeData?.['employee-id'] || employeeData?.employee_id || employeeData?.id)
    const employeeNumber = normalizeValue(employeeData?.['employee-number'] || employeeData?.employee_number)
    const active = normalizeValue(employeeData?.active)
    const fullName = normalizeValue(employeeData?.['full-name'] || employeeData?.full_name)
    const firstName = normalizeValue(employeeData?.['first-name'] || employeeData?.first_name || employeeData?.firstName)
    const middleName = normalizeValue(employeeData?.['middle-name'] || employeeData?.middle_name || employeeData?.middleName)
    const lastName = normalizeValue(employeeData?.['last-name'] || employeeData?.last_name || employeeData?.lastName)
    const employmentType = normalizeValue(employeeData?.['employment-type'] || employeeData?.employment_type)
    const jobTitle = normalizeValue(employeeData?.['job-title'] || employeeData?.job_title || employeeData?.position)
    
    // Handle department - it might be an object with 'title' and 'code' properties
    let department = null
    let departmentCode = null
    if (employeeData?.department) {
      if (typeof employeeData.department === 'string') {
        department = employeeData.department.trim() || null
      } else if (typeof employeeData.department === 'object') {
        department = normalizeValue(employeeData.department?.title)
        departmentCode = normalizeValue(employeeData.department?.code)
      }
    }
    
    // Handle region - it might be an object with 'title' and 'code' properties
    let region = null
    let regionCode = null
    if (employeeData?.region) {
      if (typeof employeeData.region === 'string') {
        region = employeeData.region.trim() || null
      } else if (typeof employeeData.region === 'object') {
        region = normalizeValue(employeeData.region?.title)
        regionCode = normalizeValue(employeeData.region?.code)
      }
    }
    
    const contractStart = normalizeValue(employeeData?.['contract-start'] || employeeData?.contract_start || employeeData?.hire_date || employeeData?.['hire-date'])
    const contractEnd = normalizeValue(employeeData?.['contract-end'] || employeeData?.contract_end || employeeData?.termination_date || employeeData?.['termination-date'])
    const residentialStatus = normalizeValue(employeeData?.['residential-status'] || employeeData?.residential_status)
    const gender = normalizeValue(employeeData?.gender)
    const dateOfBirth = normalizeValue(employeeData?.['date-of-birth'] || employeeData?.date_of_birth)
    const idNo = normalizeValue(employeeData?.['id-no'] || employeeData?.id_no)
    const pin = normalizeValue(employeeData?.pin)
    const telephone = normalizeValue(employeeData?.telephone || employeeData?.phone || employeeData?.phone_number || employeeData?.['phone-number'])
    const officialEmail = normalizeValue(employeeData?.['official-email'] || employeeData?.official_email || employeeData?.email)
    const personalEmail = normalizeValue(employeeData?.['personal-email'] || employeeData?.personal_email)
    const address1 = normalizeValue(employeeData?.['address-1'] || employeeData?.address_1)
    const address2 = normalizeValue(employeeData?.['address-2'] || employeeData?.address_2)
    const city = normalizeValue(employeeData?.city)
    const stateProvinceCounty = normalizeValue(employeeData?.['state-province-county'] || employeeData?.state_province_county)
    const country = normalizeValue(employeeData?.country)
    const postalCode = normalizeValue(employeeData?.['postal-code'] || employeeData?.postal_code)
    const zipCode = normalizeValue(employeeData?.['zip-code'] || employeeData?.zip_code)

    if (!employeeId) {
      console.warn('⚠️ Skipping employee with no employee_id:', JSON.stringify(employeeData).substring(0, 100))
      return false
    }

    const stmt = db.prepare(`
      INSERT INTO wingubox_employees (
        employee_id, employee_number, active, full_name, first_name, middle_name, last_name,
        employment_type, job_title, department, department_code, region, region_code,
        contract_start, contract_end, residential_status, gender, date_of_birth,
        id_no, pin, telephone, official_email, personal_email,
        address_1, address_2, city, state_province_county, country, postal_code, zip_code,
        seen_in_last_sync, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(employee_id) DO UPDATE SET
        employee_number = excluded.employee_number,
        active = excluded.active,
        full_name = excluded.full_name,
        first_name = excluded.first_name,
        middle_name = excluded.middle_name,
        last_name = excluded.last_name,
        employment_type = excluded.employment_type,
        job_title = excluded.job_title,
        department = excluded.department,
        department_code = excluded.department_code,
        region = excluded.region,
        region_code = excluded.region_code,
        contract_start = excluded.contract_start,
        contract_end = excluded.contract_end,
        residential_status = excluded.residential_status,
        gender = excluded.gender,
        date_of_birth = excluded.date_of_birth,
        id_no = excluded.id_no,
        pin = excluded.pin,
        telephone = excluded.telephone,
        official_email = excluded.official_email,
        personal_email = excluded.personal_email,
        address_1 = excluded.address_1,
        address_2 = excluded.address_2,
        city = excluded.city,
        state_province_county = excluded.state_province_county,
        country = excluded.country,
        postal_code = excluded.postal_code,
        zip_code = excluded.zip_code,
        seen_in_last_sync = 1,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `)
    
    stmt.run(
      employeeId,
      employeeNumber,
      active,
      fullName,
      firstName,
      middleName,
      lastName,
      employmentType,
      jobTitle,
      department,
      departmentCode,
      region,
      regionCode,
      contractStart,
      contractEnd,
      residentialStatus,
      gender,
      dateOfBirth,
      idNo,
      pin,
      telephone,
      officialEmail,
      personalEmail,
      address1,
      address2,
      city,
      stateProvinceCounty,
      country,
      postalCode,
      zipCode
    )
    return true
  } catch (e) {
    console.error('Error inserting employee:', e.message)
    console.error('Employee data:', JSON.stringify(employeeData).substring(0, 200))
    return false
  }
}

async function main() {
  try {
    console.log('➡️ Fetching token from Wingubox...')
    const token = await getToken({
      app: WINGUBOX_APP,
      consumerKey: WINGUBOX_CONSUMER_KEY,
      consumerSecret: WINGUBOX_CONSUMER_SECRET,
    })
    console.log('✅ Token obtained (length):', token.length)

    console.log('\n➡️ Fetching employees...')
    const employeesResponse = await getEmployees({
      app: WINGUBOX_APP,
      token,
      employmentType: '%', // Fetch all employment types
      fields: 'contract-info', // You can change this to 'personal-info' or other fields
    })

    console.log('✅ Employees response received')
    
    // Initialize database
    const db = createDb()

    // Mark all rows as not seen for this sync run; seen rows will be set back to 1 by upsert.
    db.prepare('UPDATE wingubox_employees SET seen_in_last_sync = 0').run()
    
    // Extract employees from response (adjust based on actual API response structure)
    let employees = []
    if (employeesResponse?.results?.data) {
      if (Array.isArray(employeesResponse.results.data)) {
        employees = employeesResponse.results.data
      } else if (employeesResponse.results.data.employees) {
        employees = employeesResponse.results.data.employees
      } else if (employeesResponse.results.data.employee) {
        employees = [employeesResponse.results.data.employee]
      } else {
        // Try to find any array in the response
        const findArray = (obj) => {
          if (Array.isArray(obj)) return obj
          if (typeof obj !== 'object' || obj === null) return null
          for (const value of Object.values(obj)) {
            const arr = findArray(value)
            if (arr) return arr
          }
          return null
        }
        employees = findArray(employeesResponse.results.data) || []
      }
    }

    console.log(`\n📊 Found ${employees.length} employees`)

    if (employees.length === 0) {
      console.log('⚠️ No employees found in response. Response structure:')
      console.log(JSON.stringify(employeesResponse, null, 2).substring(0, 500))
    }

    // Save employees to database
    console.log('\n💾 Saving employees to database...')
    let saved = 0
    let skipped = 0

    for (const employee of employees) {
      const success = insertOrUpdateEmployee(db, employee)
      if (success) {
        saved++
      } else {
        skipped++
      }
    }

    // Reconcile rows that were not returned by Wingubox.
    // Default behavior: set active = '0' for missing employees (keeps history).
    // Optional: permanently delete missing rows by setting WINGUBOX_PRUNE_MISSING=1.
    const prune = ['1', 'true', 'yes'].includes(String(process.env.WINGUBOX_PRUNE_MISSING || '').toLowerCase())
    const missingCount = db.prepare('SELECT COUNT(*) AS c FROM wingubox_employees WHERE seen_in_last_sync = 0').get().c
    if (missingCount > 0) {
      if (prune) {
        db.prepare('DELETE FROM wingubox_employees WHERE seen_in_last_sync = 0').run()
        console.log(`🧹 Pruned ${missingCount} employees not returned by API (WINGUBOX_PRUNE_MISSING=1)`)
      } else {
        db.prepare(`UPDATE wingubox_employees SET active = '0', updated_at = CURRENT_TIMESTAMP WHERE seen_in_last_sync = 0`).run()
        console.log(`ℹ️ Marked ${missingCount} employees as inactive (not returned by API)`)
      }
    }

    console.log(`✅ Saved ${saved} employees`)
    if (skipped > 0) {
      console.log(`⚠️ Skipped ${skipped} employees due to errors`)
    }

    db.close()
    console.log('\n✅ Done!')
  } catch (err) {
    console.error('\n❌ ERROR:')
    if (err.response) {
      console.error('Response:', err.response.status, err.response.statusText)
      console.error('Data:', JSON.stringify(err.response.data, null, 2))
    } else {
      console.error(err.message)
      if (err.stack) console.error(err.stack)
    }
    process.exit(1)
  }
}

main()

