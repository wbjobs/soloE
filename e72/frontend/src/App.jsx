import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import './App.css'

function App() {
  const [data, setData] = useState([])
  const [latestData, setLatestData] = useState({ vibration_temp: 0, rpm: 0, isAlert: false })
  const [threshold, setThreshold] = useState(85)
  const [newThreshold, setNewThreshold] = useState(85)
  const [alerts, setAlerts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAlerts, setShowAlerts] = useState(false)

  const fetchData = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/data')
      const result = await response.json()
      setData(result)
      
      if (result.length > 0) {
        const latest = result[result.length - 1]
        setLatestData({
          vibration_temp: latest.vibration_temp,
          rpm: latest.rpm,
          isAlert: latest.vibration_temp > threshold
        })
      }
      setIsLoading(false)
    } catch (error) {
      console.error('获取数据失败:', error)
    }
  }

  const fetchThreshold = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/threshold')
      const result = await response.json()
      setThreshold(result.threshold)
      setNewThreshold(result.threshold)
    } catch (error) {
      console.error('获取阈值失败:', error)
    }
  }

  const fetchAlerts = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/alerts?limit=20')
      const result = await response.json()
      setAlerts(result)
    } catch (error) {
      console.error('获取告警历史失败:', error)
    }
  }

  const updateThreshold = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newThreshold })
      })
      const result = await response.json()
      if (result.success) {
        setThreshold(result.threshold)
        alert(`阈值已更新为 ${result.threshold}°C`)
      }
    } catch (error) {
      console.error('更新阈值失败:', error)
    }
  }

  useEffect(() => {
    fetchThreshold()
    fetchAlerts()
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 2000)
    const alertInterval = setInterval(fetchAlerts, 5000)
    return () => {
      clearInterval(interval)
      clearInterval(alertInterval)
    }
  }, [threshold])

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatAlertTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN')
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Modbus RTU 设备监控面板</h1>
        <p className="subtitle">实时监控振动温度和转速数据</p>
      </header>

      <div className="dashboard">
        <div className="cards-container">
          <div className={`card temperature-card ${latestData.isAlert ? 'alert' : ''}`}>
            <div className="card-icon">🌡️</div>
            <div className="card-content">
              <h3>振动温度</h3>
              <p className="value">
                {latestData.vibration_temp.toFixed(2)} 
                <span className="unit">°C</span>
                {latestData.isAlert && <span className="alert-badge">⚠️ 告警</span>}
              </p>
              <p className="range">阈值: {threshold}°C</p>
            </div>
          </div>

          <div className="card rpm-card">
            <div className="card-icon">🔄</div>
            <div className="card-content">
              <h3>转速</h3>
              <p className="value">{latestData.rpm.toFixed(2)} <span className="unit">RPM</span></p>
              <p className="range">范围: 1000.00 - 3000.00 RPM</p>
            </div>
          </div>
        </div>

        <div className="threshold-container">
          <h3>🔧 报警阈值设置</h3>
          <div className="threshold-controls">
            <label>振动温度上限:</label>
            <input
              type="number"
              min="0"
              max="200"
              step="0.1"
              value={newThreshold}
              onChange={(e) => setNewThreshold(parseFloat(e.target.value))}
            />
            <span className="unit">°C</span>
            <button onClick={updateThreshold}>保存设置</button>
          </div>
        </div>

        <div className="chart-container">
          <div className="chart-header">
            <h2>实时数据曲线 (最近30秒)</h2>
            <div className="status-indicator">
              <span className={`status ${isLoading ? 'loading' : 'online'}`}></span>
              <span>{isLoading ? '加载中...' : '实时更新'}</span>
            </div>
          </div>
          
          {isLoading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>正在加载数据...</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={formatTime}
                  stroke="#aaa"
                  tick={{ fontSize: 12 }}
                />
                <YAxis yAxisId="left" stroke="#ff6b6b" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" stroke="#4ecdc4" tick={{ fontSize: 12 }} />
                <Tooltip 
                  formatter={(value, name) => {
                    const unit = name === 'vibration_temp' ? '°C' : 'RPM'
                    return [`${value.toFixed(2)} ${unit}`, name === 'vibration_temp' ? '振动温度' : '转速']
                  }}
                  contentStyle={{ 
                    backgroundColor: '#2a2a4a', 
                    border: '1px solid #444',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="vibration_temp"
                  name="振动温度"
                  stroke="#ff6b6b"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rpm"
                  name="转速"
                  stroke="#4ecdc4"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="alerts-container">
          <div className="alerts-header" onClick={() => setShowAlerts(!showAlerts)}>
            <h3>📋 告警历史记录</h3>
            {alerts.length > 0 && <span className="alert-count">{alerts.length} 条</span>}
            <span className={`arrow ${showAlerts ? 'up' : 'down'}`}>▼</span>
          </div>
          
          {showAlerts && (
            <div className="alerts-list">
              {alerts.length === 0 ? (
                <p className="no-alerts">暂无告警记录</p>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className="alert-item">
                    <span className="alert-time">{formatAlertTime(alert.timestamp)}</span>
                    <span className="alert-message">{alert.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App