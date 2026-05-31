const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  loadOsmPbf,
  isGraphLoaded,
  getNodeCount,
  getEdgeCount,
  planRoute,
  snapToRoad,
  generateTrip,
  addCongestionZone,
  removeCongestionZone,
  clearCongestionZones,
  getCongestionZones,
} = require('osm-route-rs');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    graphLoaded: isGraphLoaded(),
    nodeCount: getNodeCount(),
    edgeCount: getEdgeCount(),
  });
});

app.get('/status', (req, res) => {
  res.json({
    loaded: isGraphLoaded(),
    nodeCount: getNodeCount(),
    edgeCount: getEdgeCount(),
    dataDir: DATA_DIR,
  });
});

app.post('/load', (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found: ' + filePath });
  }

  const success = loadOsmPbf(filePath);
  if (success) {
    res.json({
      success: true,
      nodeCount: getNodeCount(),
      edgeCount: getEdgeCount(),
    });
  } else {
    res.status(500).json({ success: false, error: 'Failed to load OSM data' });
  }
});

app.post('/snap', (req, res) => {
  if (!isGraphLoaded()) {
    return res.status(503).json({ error: 'Graph not loaded' });
  }

  const { lat, lon } = req.body;
  if (lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  try {
    const result = snapToRoad({ lat: parseFloat(lat), lon: parseFloat(lon) });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/route', (req, res) => {
  if (!isGraphLoaded()) {
    return res.status(503).json({ error: 'Graph not loaded' });
  }

  const { start, end, algorithm = 'astar' } = req.body;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end are required' });
  }

  try {
    const result = planRoute(
      { lat: parseFloat(start.lat), lon: parseFloat(start.lon) },
      { lat: parseFloat(end.lat), lon: parseFloat(end.lon) },
      algorithm
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/trip', (req, res) => {
  if (!isGraphLoaded()) {
    return res.status(503).json({ error: 'Graph not loaded' });
  }

  const { path, speedKmh = 50, intervalMs = 100 } = req.body;
  if (!path || !Array.isArray(path) || path.length < 2) {
    return res.status(400).json({ error: 'path must be an array with at least 2 points' });
  }

  try {
    const coords = path.map((p) => ({
      lat: parseFloat(p.lat),
      lon: parseFloat(p.lon),
    }));
    const trip = generateTrip(coords, parseFloat(speedKmh), parseFloat(intervalMs));
    res.json({
      success: true,
      steps: trip,
      totalDuration: trip.length > 0 ? trip[trip.length - 1].timestamp : 0,
      stepCount: trip.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/congestion', (req, res) => {
  try {
    const zones = getCongestionZones();
    res.json({ success: true, zones });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/congestion', (req, res) => {
  const { id, center, radius, multiplier, color } = req.body;
  if (!id || !center || radius === undefined || multiplier === undefined) {
    return res.status(400).json({ error: 'id, center, radius, multiplier are required' });
  }

  try {
    const success = addCongestionZone({
      id,
      center: { lat: parseFloat(center.lat), lon: parseFloat(center.lon) },
      radius: parseFloat(radius),
      multiplier: parseFloat(multiplier),
      color: color || '#ef5350',
    });
    res.json({ success });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/congestion/:id', (req, res) => {
  try {
    const success = removeCongestionZone(req.params.id);
    res.json({ success });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/congestion', (req, res) => {
  try {
    const success = clearCongestionZones();
    res.json({ success });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/data/files', (req, res) => {
  if (!fs.existsSync(DATA_DIR)) {
    return res.json({ files: [] });
  }
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.osm.pbf'))
    .map((f) => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime,
      };
    });
  res.json({ files });
});

app.listen(PORT, () => {
  console.log(`Route planning server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created data directory, place .osm.pbf files there');
  }
});

module.exports = app;
