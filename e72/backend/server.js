const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
const port = process.env.API_PORT || 3000;

app.use(cors());
app.use(express.json());

const db = new Database('modbus_data.db', { verbose: console.log });

db.exec(`CREATE TABLE IF NOT EXISTS sensor_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  vibration_temp REAL NOT NULL,
  rpm REAL NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  vibration_temp REAL NOT NULL,
  threshold REAL NOT NULL,
  message TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value REAL NOT NULL
)`);

const getThreshold = () => {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const result = stmt.get('temp_threshold');
  if (result) {
    return result.value;
  }
  const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertStmt.run('temp_threshold', 85);
  return 85;
};

let tempThreshold = getThreshold();

app.post('/api/data', (req, res) => {
  const { timestamp, vibration_temp, rpm } = req.body;
  
  if (!timestamp || vibration_temp === undefined || rpm === undefined) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const receiveTime = new Date();
  console.log(`[${receiveTime.toISOString()}] 收到数据 - 时间戳: ${timestamp}, 振动温度: ${vibration_temp}°C, 转速: ${rpm} RPM`);

  let isAlert = false;
  if (vibration_temp > tempThreshold) {
    isAlert = true;
    const alertMessage = `温度超过阈值！当前温度: ${vibration_temp}°C, 阈值: ${tempThreshold}°C`;
    console.log(`[${receiveTime.toISOString()}] ⚠️ 告警: ${alertMessage}`);
    
    try {
      const alertStmt = db.prepare('INSERT INTO alerts (timestamp, vibration_temp, threshold, message) VALUES (?, ?, ?, ?)');
      alertStmt.run(timestamp, vibration_temp, tempThreshold, alertMessage);
    } catch (err) {
      console.error('告警记录失败:', err.message);
    }
  }

  try {
    const stmt = db.prepare('INSERT INTO sensor_data (timestamp, vibration_temp, rpm) VALUES (?, ?, ?)');
    const info = stmt.run(timestamp, vibration_temp, rpm);
    res.status(200).json({ id: info.lastInsertRowid, isAlert, threshold: tempThreshold });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: '数据存储失败' });
  }
});

app.get('/api/data', (req, res) => {
  const thirtySecondsAgo = Date.now() - 30000;
  
  try {
    const stmt = db.prepare('SELECT timestamp, vibration_temp, rpm FROM sensor_data WHERE timestamp > ? ORDER BY timestamp ASC');
    const rows = stmt.all(thirtySecondsAgo);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/data/latest', (req, res) => {
  try {
    const stmt = db.prepare('SELECT timestamp, vibration_temp, rpm FROM sensor_data ORDER BY timestamp DESC LIMIT 1');
    const row = stmt.get();
    if (row) {
      row.isAlert = row.vibration_temp > tempThreshold;
      row.threshold = tempThreshold;
    }
    res.json(row || { threshold: tempThreshold });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/threshold', (req, res) => {
  res.json({ threshold: tempThreshold });
});

app.post('/api/threshold', (req, res) => {
  const { value } = req.body;
  
  if (value === undefined || value <= 0) {
    return res.status(400).json({ error: '无效的阈值设置' });
  }

  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('temp_threshold', value);
    tempThreshold = value;
    console.log(`[${new Date().toISOString()}] 阈值已更新为: ${value}°C`);
    res.json({ success: true, threshold: tempThreshold });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: '阈值设置失败' });
  }
});

app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const stmt = db.prepare('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?');
    const rows = stmt.all(limit);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.listen(port, () => {
  console.log(`后端服务运行在 http://localhost:${port}`);
  console.log(`当前温度阈值: ${tempThreshold}°C`);
});