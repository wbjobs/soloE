const BatteryGauge = ({ socPercent, capacity, currentSoc, charge, discharge }) => {
  const percent = Math.min(100, Math.max(0, socPercent || 0))
  const radius = 30
  const stroke = 6
  const normalizedRadius = radius - stroke * 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (percent / 100) * circumference

  const getColor = () => {
    if (percent > 60) return '#4ade80'
    if (percent > 30) return '#fbbf24'
    return '#f87171'
  }

  const color = getColor()
  const isCharging = charge > 0.001
  const isDischarging = discharge > 0.001

  return (
    <div className="battery-gauge-container">
      <div className="battery-gauge">
        <svg height={radius * 2} width={radius * 2}>
          <circle
            stroke="#334155"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            stroke={color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${circumference} ${circumference}`}
            style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s ease' }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>
        <div className="battery-gauge-content">
          <div className="battery-percent" style={{ color }}>
            {percent.toFixed(1)}%
          </div>
          <div className="battery-soc">
            {currentSoc?.toFixed(2)} / {capacity?.toFixed(0)} kWh
          </div>
        </div>
      </div>
      {(isCharging || isDischarging) && (
        <div className={`battery-status ${isCharging ? 'charging' : 'discharging'}`}>
          {isCharging && (
            <span className="charge-text">
              ⚡ +{charge.toFixed(2)} kW
            </span>
          )}
          {isDischarging && (
            <span className="discharge-text">
              🔋 -{discharge.toFixed(2)} kW
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default BatteryGauge
