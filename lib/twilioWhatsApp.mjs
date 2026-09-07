/**
 * Twilio WhatsApp delivery for scheduled reports (PDF + summary).
 *
 * Twilio must fetch the PDF from a public HTTPS URL — set PUBLIC_APP_URL to your live site.
 * Scheduled outbound WhatsApp usually requires an approved Content Template (contentSid).
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp-reports')

/** token -> { path, filename, expiresAt } */
const tempMedia = new Map()

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true })
}

function parsePhoneList(raw) {
  return String(raw || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeWhatsAppPhone)
    .filter(Boolean)
}

/** E.164 required: +2547..., +2567... */
export function normalizeWhatsAppPhone(raw) {
  let s = String(raw || '').trim().replace(/\s/g, '')
  if (!s) return ''
  if (s.startsWith('whatsapp:')) s = s.slice('whatsapp:'.length)
  if (!s.startsWith('+')) {
    if (s.startsWith('0')) return null // require explicit country code in env
    s = `+${s}`
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  return s
}

export function isWhatsAppReportEnabled() {
  const flag = String(process.env.WHATSAPP_REPORT_ENABLED ?? 'false').toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(flag)) return false
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM)
}

export function getWhatsAppReportRecipients(countryParam = 'Kenya') {
  const country = String(countryParam || 'Kenya').trim() || 'Kenya'
  const isUganda = country.toLowerCase() === 'uganda'
  const fromEnv = parsePhoneList(
    isUganda ? process.env.WHATSAPP_REPORT_TO_UGANDA : process.env.WHATSAPP_REPORT_TO,
  )
  return [...new Set(fromEnv)]
}

function getPublicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '')
}

function getContentSid(reportKind) {
  const kind = String(reportKind || '').toLowerCase()
  const byKind =
    kind === 'daily_par'
      ? process.env.TWILIO_WHATSAPP_CONTENT_SID_DAILY_PAR
      : kind === 'weekly_par'
        ? process.env.TWILIO_WHATSAPP_CONTENT_SID_WEEKLY_PAR
        : kind === 'daily_disb'
          ? process.env.TWILIO_WHATSAPP_CONTENT_SID_DAILY_DISB
          : ''
  return String(byKind || process.env.TWILIO_WHATSAPP_CONTENT_SID || '').trim()
}

function cleanupExpiredMedia() {
  const now = Date.now()
  for (const [token, meta] of tempMedia.entries()) {
    if (meta.expiresAt <= now) {
      tempMedia.delete(token)
      try {
        if (meta.path && fs.existsSync(meta.path)) fs.unlinkSync(meta.path)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Write PDF to disk and return a public URL Twilio can fetch (valid ~2 hours).
 */
export function createTempReportMediaUrl(pdfBuffer, filename = 'report.pdf') {
  const base = getPublicAppUrl()
  if (!base) {
    throw new Error('PUBLIC_APP_URL is not set (HTTPS URL Twilio can reach, e.g. https://exco.yourdomain.com)')
  }
  ensureTempDir()
  cleanupExpiredMedia()
  const token = crypto.randomBytes(24).toString('hex')
  const safeName = String(filename || 'report.pdf').replace(/[^\w.\-]+/g, '_')
  const filePath = path.join(TEMP_DIR, `${token}.pdf`)
  fs.writeFileSync(filePath, pdfBuffer)
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000
  tempMedia.set(token, { path: filePath, filename: safeName, expiresAt })
  const mediaUrl = `${base}/api/reports/whatsapp-media/${token}`
  return { token, mediaUrl, cleanup: () => deleteTempReportMedia(token) }
}

export function deleteTempReportMedia(token) {
  const meta = tempMedia.get(token)
  if (!meta) return
  tempMedia.delete(token)
  try {
    if (meta.path && fs.existsSync(meta.path)) fs.unlinkSync(meta.path)
  } catch {
    /* ignore */
  }
}

/** Express route: Twilio fetches PDF (unguessable token, short TTL). */
export function registerWhatsAppMediaRoute(app) {
  app.get('/api/reports/whatsapp-media/:token', (req, res) => {
    const token = String(req.params.token || '').trim()
    const meta = tempMedia.get(token)
    if (!meta || meta.expiresAt <= Date.now()) {
      return res.status(404).send('Not found or expired')
    }
    if (!meta.path || !fs.existsSync(meta.path)) {
      return res.status(404).send('Not found')
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${meta.filename}"`)
    fs.createReadStream(meta.path).pipe(res)
  })
}

async function getTwilioClient() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim()
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim()
  if (!accountSid || !authToken) return null
  const twilio = (await import('twilio')).default
  return twilio(accountSid, authToken)
}

function truncateCaption(text, max = 1024) {
  const s = String(text || '').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * Send PDF + summary to each director phone via Twilio WhatsApp.
 */
export async function sendWhatsAppReport({
  countryParam = 'Kenya',
  reportKind = 'daily_par',
  body = '',
  pdfBuffer,
  filename = 'report.pdf',
} = {}) {
  if (!isWhatsAppReportEnabled()) {
    return { ok: false, skipped: true, reason: 'WHATSAPP_REPORT_ENABLED is off or Twilio not configured' }
  }

  const phones = getWhatsAppReportRecipients(countryParam)
  if (!phones.length) {
    const country = String(countryParam || 'Kenya').trim()
    const hint =
      country.toLowerCase() === 'uganda'
        ? 'Set WHATSAPP_REPORT_TO_UGANDA (+256..., comma-separated E.164)'
        : 'Set WHATSAPP_REPORT_TO (+254..., comma-separated E.164)'
    return { ok: false, skipped: true, reason: hint, country }
  }

  const from = String(process.env.TWILIO_WHATSAPP_FROM || '').trim()
  if (!from.startsWith('whatsapp:')) {
    return { ok: false, skipped: true, reason: 'TWILIO_WHATSAPP_FROM must be whatsapp:+...' }
  }

  if (!pdfBuffer || !pdfBuffer.length) {
    return { ok: false, skipped: true, reason: 'empty PDF' }
  }

  const client = await getTwilioClient()
  if (!client) {
    return { ok: false, skipped: true, reason: 'Twilio client not configured' }
  }

  let media
  try {
    media = createTempReportMediaUrl(pdfBuffer, filename)
  } catch (e) {
    return { ok: false, skipped: true, reason: e.message || String(e) }
  }

  const caption = truncateCaption(body)
  const contentSid = getContentSid(reportKind)
  const results = []

  try {
    for (const phone of phones) {
      const to = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`
      try {
        let message
        if (contentSid) {
          // Approved template: variables {{1}} = summary, {{2}} = media URL (configure in Twilio Content)
          message = await client.messages.create({
            from,
            to,
            contentSid,
            contentVariables: JSON.stringify({ 1: caption, 2: media.mediaUrl }),
          })
        } else {
          message = await client.messages.create({
            from,
            to,
            body: caption,
            mediaUrl: [media.mediaUrl],
          })
        }
        results.push({ phone, ok: true, sid: message.sid, status: message.status })
      } catch (e) {
        const msg = e.message || String(e)
        console.error(`[WhatsApp] ${phone} failed:`, msg)
        results.push({ phone, ok: false, error: msg })
      }
    }
  } finally {
    media.cleanup()
  }

  const ok = results.some((r) => r.ok)
  return {
    ok,
    skipped: false,
    phones,
    contentSid: contentSid || null,
    results,
    usedTemplate: !!contentSid,
  }
}
