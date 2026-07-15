import React, { useId, useMemo } from 'react'

/** Phoenix brand orange */
const ORANGE = '#EF5322'
const ORANGE_SOFT = '#F47A52'
const ORANGE_DEEP = '#C9441A'
const TRACK = '#e5e7eb' // gray-200
const TICK = '#9ca3af' // gray-400
const LABEL = '#6b7280' // gray-500
const VALUE = '#111827' // gray-900

/**
 * Semi-circular arc gauge — white card + app orange fill.
 */
function ParArcGauge({
  value,
  label,
  hint,
  loading = false,
  max = 100,
  dangerFrom = 40,
  size = 260,
}) {
  const uid = useId().replace(/:/g, '')
  const numeric = Number(value)
  const hasValue = Number.isFinite(numeric)
  const clamped = hasValue ? Math.max(0, Math.min(max, numeric)) : 0

  const startAngle = 200
  const endAngle = -20
  const sweep = startAngle - endAngle

  const cx = size / 2
  const cy = size * 0.58
  const r = size * 0.38
  const stroke = Math.max(8, size * 0.045)
  const tickOuter = r + stroke * 0.55
  const tickInnerMajor = r - stroke * 0.85
  const tickInnerMinor = r - stroke * 0.45
  const labelR = r + stroke * 1.35

  const polar = (angleDeg, radius) => {
    const rad = (angleDeg * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy - radius * Math.sin(rad),
    }
  }

  const describeArc = (fromDeg, toDeg, radius) => {
    const start = polar(fromDeg, radius)
    const end = polar(toDeg, radius)
    const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`
  }

  const valueAngle = startAngle - (clamped / max) * sweep
  const dangerAngle = startAngle - (Math.min(max, Math.max(0, dangerFrom)) / max) * sweep
  const inDanger = hasValue && clamped >= dangerFrom

  const ticks = useMemo(() => {
    const items = []
    const majorStep = max <= 100 ? 20 : 30
    const minorStep = majorStep / 4
    for (let v = 0; v <= max + 0.001; v += minorStep) {
      const isMajor = Math.abs(v % majorStep) < 0.001 || Math.abs(v - max) < 0.001
      const ang = startAngle - (v / max) * sweep
      items.push({ v, ang, isMajor })
    }
    return items
  }, [max, startAngle, sweep])

  const display = loading ? '…' : hasValue ? numeric.toFixed(1) : '—'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-1 px-1">
        <p className="text-sm font-semibold tracking-wide text-gray-900">{label}</p>
        {hint ? (
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(239, 83, 34, 0.85)' }}>
            {hint}
          </p>
        ) : null}
      </div>

      <div className="relative mx-auto" style={{ width: size, height: size * 0.72 }}>
        <svg
          width={size}
          height={size * 0.72}
          viewBox={`0 0 ${size} ${size * 0.72}`}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id={`par-fill-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={ORANGE_SOFT} />
              <stop offset="100%" stopColor={ORANGE} />
            </linearGradient>
          </defs>

          {/* Background track */}
          <path
            d={describeArc(startAngle, endAngle, r)}
            fill="none"
            stroke={TRACK}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />

          {/* Orange danger outer arc (upper end of scale) */}
          <path
            d={describeArc(dangerAngle, endAngle, r + stroke * 0.72)}
            fill="none"
            stroke={ORANGE_DEEP}
            strokeWidth={Math.max(2, stroke * 0.28)}
            strokeLinecap="butt"
            opacity={0.9}
          />

          {/* Value fill */}
          {!loading && hasValue && clamped > 0 ? (
            <path
              d={describeArc(startAngle, valueAngle, r)}
              fill="none"
              stroke={`url(#par-fill-${uid})`}
              strokeWidth={stroke}
              strokeLinecap="butt"
            />
          ) : null}

          {/* Tick marks + labels */}
          {ticks.map((t) => {
            const outer = polar(t.ang, tickOuter)
            const inner = polar(t.ang, t.isMajor ? tickInnerMajor : tickInnerMinor)
            const lab = polar(t.ang, labelR)
            const tickDanger = t.v >= dangerFrom
            return (
              <g key={`t-${t.v}`}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={tickDanger && t.isMajor ? ORANGE : TICK}
                  strokeWidth={t.isMajor ? 1.5 : 1}
                  opacity={t.isMajor ? 1 : 0.5}
                />
                {t.isMajor ? (
                  <text
                    x={lab.x}
                    y={lab.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={tickDanger ? ORANGE_DEEP : LABEL}
                    fontSize={size * 0.042}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fontWeight="500"
                  >
                    {Math.round(t.v)}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* Value tip */}
          {!loading && hasValue ? (
            <circle
              cx={polar(valueAngle, r).x}
              cy={polar(valueAngle, r).y}
              r={Math.max(2.5, stroke * 0.22)}
              fill={inDanger ? ORANGE_DEEP : ORANGE}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          ) : null}

          {/* Center readout */}
          <text
            x={cx}
            y={cy - size * 0.02}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={VALUE}
            fontSize={size * 0.14}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight="700"
            letterSpacing="-0.02em"
          >
            {display}
          </text>
          <text
            x={cx}
            y={cy + size * 0.09}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={ORANGE}
            fontSize={size * 0.04}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
          >
            {loading ? 'loading' : '%'}
          </text>
        </svg>
      </div>
    </div>
  )
}

export default ParArcGauge
