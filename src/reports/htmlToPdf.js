/**
 * Render a full HTML document to a PDF Buffer (A4, print backgrounds).
 * Used for Daily PAR email attachments.
 * Puppeteer is loaded lazily so a missing install cannot crash server startup.
 */
export async function renderHtmlToPdfBuffer(html, { timeoutMs = 60_000 } = {}) {
  let puppeteer
  try {
    puppeteer = (await import('puppeteer')).default
  } catch (err) {
    throw new Error(
      `Puppeteer is not available (run npm install on the server). ${err.message || err}`,
    )
  }

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--disable-gpu',
    ],
  }
  // Optional: point at system Chrome/Chromium if bundled browser is missing
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }

  const browser = await puppeteer.launch(launchOpts)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
    await page.setContent(String(html || ''), {
      waitUntil: ['load', 'networkidle0'],
      timeout: timeoutMs,
    })
    try {
      await page.evaluate(() => document.fonts?.ready)
    } catch {
      // Fonts API may be unavailable; continue
    }
    await new Promise((r) => setTimeout(r, 400))

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
