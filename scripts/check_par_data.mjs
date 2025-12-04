// Quick script to check PAR data in database
import Database from 'better-sqlite3'

const db = new Database('data/app.db', { readonly: true })

try {
  // Check PAR table
  const parCount = db.prepare('SELECT COUNT(*) as count FROM PAR').get()
  console.log(`\nPAR table has ${parCount.count} rows`)
  
  if (parCount.count > 0) {
    const latest = db.prepare('SELECT time, Past_Arrears_missed, Open_loans FROM PAR ORDER BY time DESC LIMIT 2000').all()
    console.log('\nLatest ll PAR entries:')
    latest.forEach((row, idx) => {
      console.log(`${idx + 1}. Time: ${row.time}, Past Missed: ${row.Past_Arrears_missed || 0}, Open Loans: ${row.Open_loans || 0}`)
    })
    
    // Check for unique months
    const months = db.prepare(`
      SELECT DISTINCT 
        substr(time, 1, 7) as month
      FROM PAR 
      WHERE time IS NOT NULL 
      ORDER BY month DESC
    `).all()
    console.log(`\nUnique months in data: ${months.length}`)
    months.forEach(m => console.log(`  - ${m.month}`))
  } else {
    console.log('\n⚠️  No PAR data found. Trigger a snapshot to populate data.')
  }
  
  // Check Open_loans table
  const openLoansCount = db.prepare('SELECT COUNT(*) as count FROM Open_loans').get()
  console.log(`\nOpen_loans table has ${openLoansCount.count} rows`)
  
  // Check Past_Missed_repayment table
  const pastMissedCount = db.prepare('SELECT COUNT(*) as count FROM Past_Missed_repayment').get()
  console.log(`Past_Missed_repayment table has ${pastMissedCount.count} rows`)
  
} catch (e) {
  console.error('Error:', e.message)
} finally {
  db.close()
}

