import React, { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import axios from 'axios';

const API_BASE = '/api';
const MODES = {
  ROUTE: 'route',
  ADD_CONGESTION: 'add_congestion',
};

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const startMarker = useRef(null);
  const endMarker = useRef(null);
  const vehicleMarker = useRef(null);
  const routeSource = useRef(null);
  const congestionSource = useRef(null);
  const tripAnimationRef = useRef(null);
  const drawingMarker = useRef(null);

  const [graphLoaded, setGraphLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);
  const [algorithm, setAlgorithm] = useState('astar');
  const [routeResult, setRouteResult] = useState(null);
  const [tripSteps, setTripSteps] = useState([]);
  const [isTripping, setIsTripping] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(50);
  const [statusMessage, setStatusMessage] = useState('请先加载OSM数据');
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [mode, setMode] = useState(MODES.ROUTE);
  const [congestionZones, setCongestionZones] = useState([]);
  const [congestionRadius, setCongestionRadius] = useState(500);
  const [congestionMultiplier, setCongestionMultiplier] = useState(3.0);
  const [currentTripStep, setCurrentTripStep] = useState(null);
  const [showEnergyPanel, setShowEnergyPanel] = useState(true);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [116.3972, 39.9075],
      zoom: 12,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    map.current.on('load', () => {
      map.current.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.current.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#1976d2',
          'line-width': 6,
          'line-opacity': 0.8,
        },
      });

      map.current.addSource('congestion', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.current.addLayer({
        id: 'congestion-fill',
        type: 'fill',
        source: 'congestion',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.35,
        },
      });

      map.current.addLayer({
        id: 'congestion-outline',
        type: 'line',
        source: 'congestion',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
        },
      });

      routeSource.current = map.current.getSource('route');
      congestionSource.current = map.current.getSource('congestion');
    });

    map.current.on('click', handleMapClick);

    return () => {
      if (tripAnimationRef.current) {
        cancelAnimationFrame(tripAnimationRef.current);
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    checkStatus();
    loadFiles();
    loadCongestionZones();
  }, []);

  useEffect(() => {
    if (congestionSource.current) {
      updateCongestionLayer();
    }
  }, [congestionZones]);

  const checkStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/status`);
      setGraphLoaded(res.data.loaded);
      setNodeCount(res.data.nodeCount);
      setEdgeCount(res.data.edgeCount);
      if (res.data.loaded) {
        setStatusMessage(`图已加载: ${res.data.nodeCount} 节点, ${res.data.edgeCount} 边`);
      }
    } catch (e) {
      console.error('Status check failed:', e);
    }
  };

  const loadFiles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/data/files`);
      setFiles(res.data.files);
      if (res.data.files.length > 0) {
        setSelectedFile(res.data.files[0].name);
      }
    } catch (e) {
      console.error('Load files failed:', e);
    }
  };

  const loadCongestionZones = async () => {
    try {
      const res = await axios.get(`${API_BASE}/congestion`);
      if (res.data.success) {
        setCongestionZones(res.data.zones || []);
      }
    } catch (e) {
      console.error('Load congestion zones failed:', e);
    }
  };

  const updateCongestionLayer = () => {
    if (!congestionSource.current) return;
    const features = congestionZones.map((zone) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [createCircleCoordinates(zone.center, zone.radius)],
      },
      properties: {
        id: zone.id,
        color: zone.color,
        multiplier: zone.multiplier,
      },
    }));
    congestionSource.current.setData({
      type: 'FeatureCollection',
      features,
    });
  };

  const createCircleCoordinates = (center, radiusMeters) => {
    const points = [];
    const steps = 64;
    const earthRadius = 6371000;
    const latRad = (center.lat * Math.PI) / 180;
    const lonRad = (center.lon * Math.PI) / 180;
    const dRad = radiusMeters / earthRadius;

    for (let i = 0; i <= steps; i++) {
      const bearing = (i * 2 * Math.PI) / steps;
      const lat = Math.asin(
        Math.sin(latRad) * Math.cos(dRad) +
          Math.cos(latRad) * Math.sin(dRad) * Math.cos(bearing)
      );
      const dLon = Math.atan2(
        Math.sin(bearing) * Math.sin(dRad) * Math.cos(latRad),
        Math.cos(dRad) - Math.sin(latRad) * Math.sin(lat)
      );
      const lon = ((lonRad + dLon + Math.PI) % (2 * Math.PI)) - Math.PI;
      points.push([(lon * 180) / Math.PI, (lat * 180) / Math.PI]);
    }
    return points;
  };

  const handleLoadData = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setStatusMessage('正在加载OSM数据...');
    try {
      const res = await axios.post(`${API_BASE}/load`, { filename: selectedFile });
      if (res.data.success) {
        setGraphLoaded(true);
        setNodeCount(res.data.nodeCount);
        setEdgeCount(res.data.edgeCount);
        setStatusMessage(`加载成功: ${res.data.nodeCount} 节点, ${res.data.edgeCount} 边`);
      } else {
        setStatusMessage('加载失败');
      }
    } catch (e) {
      setStatusMessage('加载失败: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const handleMapClick = (e) => {
    if (!graphLoaded) {
      setStatusMessage('请先加载OSM数据');
      return;
    }

    const { lng, lat } = e.lngLat;
    const coord = { lat, lon: lng };

    if (mode === MODES.ADD_CONGESTION) {
      addCongestionZone(coord);
      return;
    }

    if (!startPoint || (startPoint && endPoint)) {
      if (endMarker.current) endMarker.current.remove();
      if (startMarker.current) startMarker.current.remove();
      if (vehicleMarker.current) vehicleMarker.current.remove();
      if (tripAnimationRef.current) {
        cancelAnimationFrame(tripAnimationRef.current);
      }
      setIsTripping(false);
      setEndPoint(null);
      setRouteResult(null);
      setTripSteps([]);
      setCurrentTripStep(null);

      startMarker.current = new maplibregl.Marker({ color: '#4caf50' })
        .setLngLat([lng, lat])
        .addTo(map.current);
      setStartPoint(coord);
      setStatusMessage('已设置起点, 点击地图设置终点');
    } else {
      endMarker.current = new maplibregl.Marker({ color: '#f44336' })
        .setLngLat([lng, lat])
        .addTo(map.current);
      setEndPoint(coord);
      setStatusMessage('已设置终点, 点击规划路径按钮');
    }
  };

  const addCongestionZone = async (coord) => {
    const id = `congestion_${Date.now()}`;
    const zone = {
      id,
      center: coord,
      radius: congestionRadius,
      multiplier: congestionMultiplier,
      color: '#ef5350',
    };

    try {
      const res = await axios.post(`${API_BASE}/congestion`, zone);
      if (res.data.success) {
        setCongestionZones((prev) => [...prev, zone]);
        setStatusMessage(`已添加拥堵区域 (半径: ${congestionRadius}m, 代价倍率: x${congestionMultiplier})`);
      }
    } catch (e) {
      setStatusMessage('添加拥堵区域失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleRemoveCongestionZone = async (zoneId) => {
    try {
      const res = await axios.delete(`${API_BASE}/congestion/${zoneId}`);
      if (res.data.success) {
        setCongestionZones((prev) => prev.filter((z) => z.id !== zoneId));
        setStatusMessage('已移除拥堵区域');
      }
    } catch (e) {
      setStatusMessage('移除失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleClearCongestionZones = async () => {
    try {
      const res = await axios.delete(`${API_BASE}/congestion`);
      if (res.data.success) {
        setCongestionZones([]);
        setStatusMessage('已清除所有拥堵区域');
      }
    } catch (e) {
      setStatusMessage('清除失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handlePlanRoute = async () => {
    if (!startPoint || !endPoint) return;
    setLoading(true);
    setStatusMessage('正在规划路径...');

    try {
      const res = await axios.post(`${API_BASE}/route`, {
        start: startPoint,
        end: endPoint,
        algorithm,
      });

      if (res.data.success) {
        setRouteResult(res.data);
        updateRouteLine(res.data.path);
        let msg = `路径规划完成: ${(res.data.distance / 1000).toFixed(2)} km, ${(res.data.duration / 60).toFixed(1)} 分钟`;
        if (res.data.congestionAvoided) {
          msg += ' (已绕开拥堵)';
        }
        setStatusMessage(msg);
      } else {
        setStatusMessage('路径规划失败: ' + (res.data.message || '未知错误'));
      }
    } catch (e) {
      setStatusMessage('规划失败: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const updateRouteLine = (path) => {
    if (!routeSource.current || !path) return;
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: path.map((p) => [p.lon, p.lat]),
          },
          properties: {},
        },
      ],
    };
    routeSource.current.setData(geojson);

    if (path.length > 0) {
      const bounds = path.reduce(
        (b, p) => b.extend([p.lon, p.lat]),
        new maplibregl.LngLatBounds([path[0].lon, path[0].lat], [path[0].lon, path[0].lat])
      );
      map.current.fitBounds(bounds, { padding: 100 });
    }
  };

  const handleStartTrip = async () => {
    if (!routeResult || !routeResult.path) return;
    setLoading(true);
    setStatusMessage('正在生成行驶轨迹...');

    try {
      const res = await axios.post(`${API_BASE}/trip`, {
        path: routeResult.path,
        speedKmh,
        intervalMs: 100,
      });

      if (res.data.success) {
        setTripSteps(res.data.steps);
        setStatusMessage(`生成 ${res.data.stepCount} 个轨迹点`);
        animateTrip(res.data.steps);
      }
    } catch (e) {
      setStatusMessage('生成轨迹失败: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const animateTrip = useCallback((steps) => {
    if (steps.length === 0) return;
    setIsTripping(true);

    if (vehicleMarker.current) {
      vehicleMarker.current.remove();
    }

    const el = document.createElement('div');
    el.style.width = '20px';
    el.style.height = '20px';
    el.style.borderRadius = '50%';
    el.style.background = '#ff9800';
    el.style.border = '3px solid white';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';

    vehicleMarker.current = new maplibregl.Marker({ element: el })
      .setLngLat([steps[0].coord.lon, steps[0].coord.lat])
      .addTo(map.current);

    let index = 0;
    const animate = () => {
      if (index >= steps.length) {
        setIsTripping(false);
        setStatusMessage('行驶完成');
        return;
      }

      const step = steps[index];
      vehicleMarker.current.setLngLat([step.coord.lon, step.coord.lat]);
      setCurrentTripStep(step);
      index++;

      tripAnimationRef.current = requestAnimationFrame(animate);
    };

    animate();
  }, []);

  const handleStopTrip = () => {
    if (tripAnimationRef.current) {
      cancelAnimationFrame(tripAnimationRef.current);
    }
    setIsTripping(false);
    setStatusMessage('已停止行驶');
  };

  const handleClear = () => {
    if (startMarker.current) startMarker.current.remove();
    if (endMarker.current) endMarker.current.remove();
    if (vehicleMarker.current) vehicleMarker.current.remove();
    if (tripAnimationRef.current) {
      cancelAnimationFrame(tripAnimationRef.current);
    }
    if (routeSource.current) {
      routeSource.current.setData({ type: 'FeatureCollection', features: [] });
    }
    setStartPoint(null);
    setEndPoint(null);
    setRouteResult(null);
    setTripSteps([]);
    setIsTripping(false);
    setCurrentTripStep(null);
    setStatusMessage('已清除');
  };

  const toggleMode = () => {
    const newMode = mode === MODES.ROUTE ? MODES.ADD_CONGESTION : MODES.ROUTE;
    setMode(newMode);
    if (newMode === MODES.ADD_CONGESTION) {
      setStatusMessage('拥堵绘制模式: 点击地图添加拥堵区域');
    } else {
      setStatusMessage('路径规划模式: 点击地图设置起终点');
    }
  };

  return (
    <div className="map-container">
      <div ref={mapContainer} className="map" />

      <div className="control-panel">
        <h1>🚗 离线路径规划</h1>

        <div className={`status-bar ${graphLoaded ? 'loaded' : loading ? 'loading' : ''}`}>
          {statusMessage}
        </div>

        <div className="select-group">
          <label>OSM PBF 文件</label>
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={graphLoaded || loading}
          >
            <option value="">请选择文件</option>
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)
              </option>
            ))}
          </select>
        </div>

        <div className="button-group">
          <button
            className="btn btn-primary"
            onClick={handleLoadData}
            disabled={!selectedFile || graphLoaded || loading}
          >
            {loading ? '加载中...' : '加载数据'}
          </button>
          <button className="btn btn-secondary" onClick={checkStatus} disabled={loading}>
            刷新状态
          </button>
        </div>

        <div className="mode-toggle">
          <button
            className={`btn ${mode === MODES.ROUTE ? 'btn-primary' : 'btn-secondary'}`}
            onClick={toggleMode}
            style={{ flex: 1 }}
          >
            📍 路径模式
          </button>
          <button
            className={`btn ${mode === MODES.ADD_CONGESTION ? 'btn-danger' : 'btn-secondary'}`}
            onClick={toggleMode}
            style={{ flex: 1 }}
          >
            🔴 绘制拥堵
          </button>
        </div>

        {mode === MODES.ADD_CONGESTION && (
          <div className="congestion-panel">
            <div className="slider-group">
              <label>
                <span>拥堵半径</span>
                <span>{congestionRadius} m</span>
              </label>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={congestionRadius}
                onChange={(e) => setCongestionRadius(Number(e.target.value))}
              />
            </div>
            <div className="slider-group">
              <label>
                <span>代价倍率</span>
                <span>x{congestionMultiplier.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="1.5"
                max="10"
                step="0.5"
                value={congestionMultiplier}
                onChange={(e) => setCongestionMultiplier(Number(e.target.value))}
              />
            </div>
            {congestionZones.length > 0 && (
              <div className="congestion-list">
                <div className="congestion-list-header">
                  <span>拥堵区域 ({congestionZones.length})</span>
                  <button
                    className="btn btn-danger btn-small"
                    onClick={handleClearCongestionZones}
                  >
                    清除全部
                  </button>
                </div>
                {congestionZones.map((zone, idx) => (
                  <div key={zone.id} className="congestion-item">
                    <span>区域 {idx + 1}: {zone.radius}m (x{zone.multiplier})</span>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleRemoveCongestionZone(zone.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === MODES.ROUTE && (
          <>
            <div className="select-group">
              <label>路径算法</label>
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                disabled={!graphLoaded || loading}
              >
                <option value="astar">双向 A* 算法 (推荐)</option>
                <option value="dijkstra">Dijkstra 算法</option>
              </select>
            </div>

            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={handlePlanRoute}
                disabled={!startPoint || !endPoint || !graphLoaded || loading}
              >
                规划路径
              </button>
              <button className="btn btn-danger" onClick={handleClear} disabled={loading}>
                清除
              </button>
            </div>
          </>
        )}

        {routeResult && routeResult.success && (
          <>
            <div className="slider-group">
              <label>
                <span>行驶速度</span>
                <span>{speedKmh} km/h</span>
              </label>
              <input
                type="range"
                min="10"
                max="120"
                value={speedKmh}
                onChange={(e) => setSpeedKmh(Number(e.target.value))}
                disabled={isTripping}
              />
            </div>

            <div className="button-group">
              {!isTripping ? (
                <button
                  className="btn btn-primary"
                  onClick={handleStartTrip}
                  disabled={loading}
                >
                  开始模拟行驶
                </button>
              ) : (
                <button className="btn btn-danger" onClick={handleStopTrip}>
                  停止行驶
                </button>
              )}
            </div>
          </>
        )}

        {routeResult && routeResult.success && routeResult.energy && (
          <div className="info-panel energy-panel" onClick={() => setShowEnergyPanel(!showEnergyPanel)}>
            <div className="info-item energy-header">
              <span className="label">⛽ 能耗估算</span>
              <span className="value">{showEnergyPanel ? '▼' : '▶'}</span>
            </div>
            {showEnergyPanel && (
              <>
                <div className="info-item">
                  <span className="label">油耗:</span>
                  <span className="value">{routeResult.energy.totalFuelLiters.toFixed(2)} L</span>
                </div>
                <div className="info-item">
                  <span className="label">电耗:</span>
                  <span className="value">{routeResult.energy.totalElectricKwh.toFixed(2)} kWh</span>
                </div>
                <div className="info-item">
                  <span className="label">油电费率:</span>
                  <span className="value">
                    {routeResult.energy.fuelRateLPer100Km.toFixed(1)} L/100km | {routeResult.energy.electricRateKwhPer100Km.toFixed(1)} kWh/100km
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">预计费用:</span>
                  <span className="value">¥{routeResult.energy.cost.toFixed(2)}</span>
                </div>
                {routeResult.energy.idleTimeSeconds > 0 && (
                  <div className="info-item">
                    <span className="label">拥堵怠速:</span>
                    <span className="value">{(routeResult.energy.idleTimeSeconds / 60).toFixed(1)} 分钟</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {currentTripStep && isTripping && (
          <div className="trip-realtime-panel">
            <div className="info-item">
              <span className="label">🚗 实时位置:</span>
              <span className="value">
                {currentTripStep.coord.lat.toFixed(5)}, {currentTripStep.coord.lon.toFixed(5)}
              </span>
            </div>
            <div className="info-item">
              <span className="label">累计油耗:</span>
              <span className="value">{currentTripStep.fuelUsed.toFixed(3)} L</span>
            </div>
            <div className="info-item">
              <span className="label">累计电耗:</span>
              <span className="value">{currentTripStep.electricUsed.toFixed(3)} kWh</span>
            </div>
            <div className="info-item">
              <span className="label">当前费率:</span>
              <span className="value">
                {currentTripStep.currentFuelRate.toFixed(1)} L/100km
              </span>
            </div>
            {currentTripStep.inCongestion && (
              <div className="info-item congestion-warning">
                <span className="label">⚠️ 拥堵中</span>
                <span className="value">x{currentTripStep.congestionMultiplier.toFixed(1)}</span>
              </div>
            )}
          </div>
        )}

        {routeResult && routeResult.success && (
          <div className="info-panel">
            <div className="info-item">
              <span className="label">总距离:</span>
              <span className="value">{(routeResult.distance / 1000).toFixed(2)} km</span>
            </div>
            <div className="info-item">
              <span className="label">预计时间:</span>
              <span className="value">{(routeResult.duration / 60).toFixed(1)} 分钟</span>
            </div>
            <div className="info-item">
              <span className="label">算法:</span>
              <span className="value">{routeResult.algorithm}</span>
            </div>
            <div className="info-item">
              <span className="label">路径节点:</span>
              <span className="value">{routeResult.path.length} 个</span>
            </div>
            {routeResult.congestionAvoided && (
              <div className="info-item">
                <span className="label">🗺️ 路径状态:</span>
                <span className="value" style={{ color: '#1976d2' }}>已绕开拥堵</span>
              </div>
            )}
          </div>
        )}

        <div className="help-text">
          💡 提示: {mode === MODES.ROUTE
            ? '点击地图设置起点(绿色)和终点(红色), 然后点击"规划路径"'
            : '点击地图添加拥堵区域, 路径规划时会自动绕开'}
        </div>
      </div>
    </div>
  );
}
