import React from 'react'

const ORANGE = '#EF5322'
const GHOST = 'rgba(239, 83, 34, 0.12)'

/** Classic 7-segment bitmasks: a b c d e f g */
const DIGITS = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
  '-': [0, 0, 0, 0, 0, 0, 1],
}

function HorizontalSeg({ x, y, w, h, on }) {
  const t = h * 0.35
  const points = [
    [x + t, y],
    [x + w - t, y],
    [x + w, y + h / 2],
    [x + w - t, y + h],
    [x + t, y + h],
    [x, y + h / 2],
  ]
    .map((p) => p.join(','))
    .join(' ')
  return <polygon points={points} fill={on ? ORANGE : GHOST} />
}

function VerticalSeg({ x, y, w, h, on }) {
  const t = w * 0.35
  const points = [
    [x + w / 2, y],
    [x + w, y + t],
    [x + w, y + h - t],
    [x + w / 2, y + h],
    [x, y + h - t],
    [x, y + t],
  ]
    .map((p) => p.join(','))
    .join(' ')
  return <polygon points={points} fill={on ? ORANGE : GHOST} />
}

function SevenSegDigit({ char, width = 22, height = 36 }) {
  const pad = 1.5
  const sw = Math.max(2.2, width * 0.16) // segment thickness
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const gap = 0.8
  const midY = pad + innerH / 2 - sw / 2
  const segs = DIGITS[char] || DIGITS['-']

  // a top, b top-right, c bottom-right, d bottom, e bottom-left, f top-left, g middle
  const horizW = innerW - sw
  const vertH = (innerH - sw * 3) / 2

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <HorizontalSeg x={pad + sw / 2} y={pad} w={horizW} h={sw} on={!!segs[0]} />
      <VerticalSeg
        x={pad + innerW - sw}
        y={pad + sw / 2 + gap}
        w={sw}
        h={vertH}
        on={!!segs[1]}
      />
      <VerticalSeg
        x={pad + innerW - sw}
        y={midY + sw / 2 + gap}
        w={sw}
        h={vertH}
        on={!!segs[2]}
      />
      <HorizontalSeg
        x={pad + sw / 2}
        y={pad + innerH - sw}
        w={horizW}
        h={sw}
        on={!!segs[3]}
      />
      <VerticalSeg x={pad} y={midY + sw / 2 + gap} w={sw} h={vertH} on={!!segs[4]} />
      <VerticalSeg x={pad} y={pad + sw / 2 + gap} w={sw} h={vertH} on={!!segs[5]} />
      <HorizontalSeg x={pad + sw / 2} y={midY} w={horizW} h={sw} on={!!segs[6]} />
    </svg>
  )
}

function Colon({ height = 36 }) {
  const size = Math.max(3, height * 0.1)
  const gap = height * 0.22
  return (
    <div
      className="flex flex-col justify-center items-center"
      style={{ height, width: size + 4, gap }}
      aria-hidden="true"
    >
      <span
        className="block rounded-[1px]"
        style={{ width: size, height: size, backgroundColor: ORANGE }}
      />
      <span
        className="block rounded-[1px]"
        style={{ width: size, height: size, backgroundColor: ORANGE }}
      />
    </div>
  )
}

/**
 * Seven-segment (digital watch) amount display in brand orange.
 * @param {number|null|undefined} amount
 * @param {boolean} [loading]
 */
export default function DigitalWatchAmount({ amount, loading = false, digitWidth = 18, digitHeight = 30 }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-1 py-2 min-h-[42px]">
        <span className="text-xs font-medium tracking-widest" style={{ color: ORANGE }}>
          ···
        </span>
      </div>
    )
  }

  const n = Number(amount)
  const has = Number.isFinite(n)
  // Whole shillings, grouped with spaces for readability (watch-like)
  const raw = has ? Math.round(Math.abs(n)).toLocaleString('en-KE') : '—'
  const chars = raw.replace(/,/g, ' ').split('')

  return (
    <div className="flex flex-col items-center gap-1 pt-1 pb-0.5">
      <div className="flex items-end gap-[2px]" role="img" aria-label={has ? `KES ${raw}` : 'No amount'}>
        {has && n < 0 ? <SevenSegDigit char="-" width={digitWidth} height={digitHeight} /> : null}
        {chars.map((ch, i) => {
          if (ch === ' ' || ch === ',') {
            return <span key={`sp-${i}`} style={{ width: Math.max(4, digitWidth * 0.28) }} />
          }
          if (ch === ':') {
            return <Colon key={`c-${i}`} height={digitHeight} />
          }
          if (ch === '—') {
            return <SevenSegDigit key={`d-${i}`} char="-" width={digitWidth} height={digitHeight} />
          }
          if (!/\d/.test(ch)) return null
          return <SevenSegDigit key={`d-${i}`} char={ch} width={digitWidth} height={digitHeight} />
        })}
      </div>
      <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-gray-400">KES</p>
    </div>
  )
}
