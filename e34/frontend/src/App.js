import React, { useEffect, useRef, useState, useCallback } from 'react';
import G6 from '@antv/g6';
import { Slider, Button, Space, Typography, Spin, message } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;

const API_BASE = '/api';
const ERROR_THRESHOLD = 0.05;

function App() {
  const graphRef = useRef(null);
  const containerRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  const [timeRange, setTimeRange] = useState({ min: Date.now() / 1000, max: Date.now() / 1000 });
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingPos, setSavingPos] = useState(false);
  const playIntervalRef = useRef(null);
  const pendingPositionsRef = useRef({});
  const saveTimeoutRef = useRef(null);

  const fetchTimeRange = async () => {
    try {
      const response = await axios.get(`${API_BASE}/time-range`);
      setTimeRange({
        min: response.data.min_time,
        max: response.data.max_time,
      });
      setCurrentTime(response.data.max_time);
    } catch (error) {
      console.error('Failed to fetch time range:', error);
    }
  };

  const fetchTopology = async (endTime = null) => {
    setLoading(true);
    try {
      const params = {};
      if (endTime) {
        params.end_time = endTime;
        params.start_time = endTime - 3600;
      }
      const response = await axios.get(`${API_BASE}/topology`, { params });
      setGraphData(response.data);
    } catch (error) {
      console.error('Failed to fetch topology:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveNodePositions = useCallback(async () => {
    const positions = Object.values(pendingPositionsRef.current);
    if (positions.length === 0) return;

    setSavingPos(true);
    try {
      await axios.post(`${API_BASE}/nodes/position`, positions);
      pendingPositionsRef.current = {};
    } catch (error) {
      console.error('Failed to save node positions:', error);
      message.error('保存节点位置失败');
    } finally {
      setSavingPos(false);
    }
  }, []);

  const debouncedSavePosition = useCallback((nodeId, x, y, fixed) => {
    pendingPositionsRef.current[nodeId] = { id: nodeId, x, y, fixed };

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveNodePositions();
    }, 500);
  }, [saveNodePositions]);

  useEffect(() => {
    fetchTimeRange();
    fetchTopology();
  }, []);

  useEffect(() => {
    if (!containerRef.current || graphData.nodes.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    if (graphRef.current) {
      graphRef.current.destroy();
    }

    const maxSize = Math.max(...graphData.nodes.map(n => n.size), 1);
    const maxValue = Math.max(...graphData.edges.map(e => e.value), 1);
    const nodeCount = graphData.nodes.length;

    const baseNodeSize = nodeCount > 50 ? 15 : nodeCount > 30 ? 20 : 25;
    const maxNodeSize = nodeCount > 50 ? 30 : nodeCount > 30 ? 40 : 50;
    const baseLinkDistance = nodeCount > 50 ? 100 : nodeCount > 30 ? 130 : 160;

    const abnormalNodeIds = new Set(
      graphData.nodes
        .filter(n => n.error_rate >= ERROR_THRESHOLD)
        .map(n => n.id)
    );

    const nodes = graphData.nodes.map(node => {
      const size = baseNodeSize + (node.size / maxSize) * (maxNodeSize - baseNodeSize);
      const isAbnormal = node.error_rate >= ERROR_THRESHOLD;
      
      return {
        ...node,
        size,
        label: `${node.name} (${(node.error_rate * 100).toFixed(1)}%)`,
        isAbnormal,
        style: {
          fill: isAbnormal ? '#ff4d4f' : getNodeColor(node.name),
          stroke: node.fixed ? '#ff7a45' : (isAbnormal ? '#cf1322' : '#fff'),
          lineWidth: node.fixed || isAbnormal ? 3 : 2,
          shadowBlur: isAbnormal ? 15 : 0,
          shadowColor: isAbnormal ? 'rgba(255, 77, 79, 0.5)' : 'transparent',
        },
        labelCfg: {
          style: {
            fill: isAbnormal ? '#cf1322' : '#333',
            fontSize: nodeCount > 30 ? 9 : 11,
            fontWeight: isAbnormal ? 'bold' : 'normal',
          },
          position: 'bottom',
        },
      };
    });

    const edges = graphData.edges.map(edge => {
      const isAbnormalEdge = abnormalNodeIds.has(edge.target);
      const isHighErrorEdge = edge.error_rate >= ERROR_THRESHOLD;
      
      return {
        ...edge,
        size: 1 + (edge.value / maxValue) * 4 + (isAbnormalEdge ? 2 : 0),
        isAbnormal: isAbnormalEdge,
        style: {
          stroke: isHighErrorEdge ? '#ff4d4f' : (isAbnormalEdge ? '#ffa39e' : (edge.protocol === 'TCP' ? '#1890ff' : '#52c41a')),
          opacity: isAbnormalEdge || isHighErrorEdge ? 1.0 : 0.7,
          endArrow: {
            path: G6.Arrow.triangle(5, 7, 0),
            d: 0,
            fill: isHighErrorEdge ? '#ff4d4f' : (isAbnormalEdge ? '#ffa39e' : (edge.protocol === 'TCP' ? '#1890ff' : '#52c41a')),
          },
        },
        label: `${edge.protocol} (${(edge.error_rate * 100).toFixed(0)}% err)`,
        labelCfg: {
          autoRotate: true,
          style: {
            fontSize: nodeCount > 30 ? 7 : 9,
            fill: isAbnormalEdge || isHighErrorEdge ? '#cf1322' : '#666',
            fontWeight: isHighErrorEdge ? 'bold' : 'normal',
          },
        },
      };
    });

    const hasFixedNodes = nodes.some(n => n.fixed && n.x !== undefined && n.y !== undefined);

    const graph = new G6.Graph({
      container: containerRef.current,
      width,
      height,
      fitView: !hasFixedNodes,
      fitViewPadding: 50,
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: (d) => d.size + 10,
        linkDistance: (edge) => {
          const base = baseLinkDistance;
          const value = edge.value || 1;
          return base + Math.min(value * 5, 100);
        },
        center: [width / 2, height / 2],
        colStrength: 500,
        edgeStrength: 0.8,
        nodeStrength: 300,
        alphaDecay: 0.028,
        alphaMin: 0.005,
        onTick: () => {},
      },
      modes: {
        default: [
          'drag-canvas',
          'zoom-canvas',
          {
            type: 'drag-node',
            delegate: false,
          },
          {
            type: 'tooltip',
            formatText(model) {
              return `
                <div style="padding: 8px; font-size: 12px;">
                  <div style="font-weight: bold; margin-bottom: 4px;">${model.name}</div>
                  <div>IP: ${model.ip}</div>
                  <div>总调用: ${model.total_calls}</div>
                  <div>错误: ${model.error_calls}</div>
                  <div style="color: ${model.isAbnormal ? '#ff4d4f' : '#52c41a'}; font-weight: bold;">
                    错误率: ${(model.error_rate * 100).toFixed(2)}%
                  </div>
                </div>
              `;
            },
          },
        ],
      },
      defaultNode: {
        type: 'circle',
      },
      defaultEdge: {
        type: 'quadratic',
        style: {
          lineAppendWidth: 5,
        },
      },
      nodeStateStyles: {
        hover: {
          lineWidth: 5,
          shadowBlur: 20,
          shadowColor: 'rgba(0, 0, 0, 0.4)',
        },
      },
      edgeStateStyles: {
        hover: {
          lineWidth: 8,
        },
      },
    });

    graph.data({ nodes, edges });
    graph.render();

    graph.on('node:dragstart', (e) => {
      if (e.item) {
        const model = e.item.getModel();
        graph.layout().unfixNode(model.id);
      }
    });

    graph.on('node:dragend', (e) => {
      if (e.item) {
        const model = e.item.getModel();
        const position = e.item.getPosition();
        graph.layout().fixNode(model.id, position.x, position.y);
        debouncedSavePosition(model.id, position.x, position.y, true);
      }
    });

    graph.on('node:click', (e) => {
      if (e.item) {
        const model = e.item.getModel();
        const isCurrentlyFixed = model.fixed;

        if (isCurrentlyFixed) {
          graph.layout().unfixNode(model.id);
          e.item.update({
            fixed: false,
            style: {
              ...model.style,
              stroke: model.isAbnormal ? '#cf1322' : '#fff',
              lineWidth: model.isAbnormal ? 3 : 2,
            },
          });
          debouncedSavePosition(model.id, model.x, model.y, false);
          message.info('节点已解锁');
        } else {
          const position = e.item.getPosition();
          graph.layout().fixNode(model.id, position.x, position.y);
          e.item.update({
            fixed: true,
            style: {
              ...model.style,
              stroke: '#ff7a45',
              lineWidth: 3,
            },
          });
          debouncedSavePosition(model.id, position.x, position.y, true);
          message.success('节点已固定');
        }
      }
    });

    graph.on('node:mouseenter', (e) => {
      graph.setItemState(e.item, 'hover', true);
    });
    graph.on('node:mouseleave', (e) => {
      graph.setItemState(e.item, 'hover', false);
    });
    graph.on('edge:mouseenter', (e) => {
      graph.setItemState(e.item, 'hover', true);
    });
    graph.on('edge:mouseleave', (e) => {
      graph.setItemState(e.item, 'hover', false);
    });

    graphRef.current = graph;

    const handleResize = () => {
      if (graphRef.current && containerRef.current) {
        graphRef.current.changeSize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (graphRef.current) {
        graphRef.current.destroy();
      }
    };
  }, [graphData, debouncedSavePosition]);

  const getNodeColor = (name) => {
    const colors = [
      '#1890ff', '#52c41a', '#faad14', '#722ed1',
      '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb', '#a0d911',
      '#096dd9', '#389e0d', '#d48806', '#531dab',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleTimeChange = (value) => {
    setCurrentTime(value);
    fetchTopology(value);
  };

  const togglePlay = () => {
    if (isPlaying) {
      clearInterval(playIntervalRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playIntervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + 60;
          if (next >= timeRange.max) {
            clearInterval(playIntervalRef.current);
            setIsPlaying(false);
            return timeRange.max;
          }
          fetchTopology(next);
          return next;
        });
      }, 800);
    }
  };

  const handleRefresh = () => {
    fetchTimeRange();
    fetchTopology();
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  };

  const abnormalCount = graphData.nodes.filter(n => n.error_rate >= ERROR_THRESHOLD).length;

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🔍 eBPF服务拓扑自动发现系统</h1>
        {abnormalCount > 0 && (
          <div className="header-warning">
            <WarningOutlined />
            <span>检测到 {abnormalCount} 个服务异常（错误率 ≥ {ERROR_THRESHOLD * 100}%）</span>
          </div>
        )}
      </header>
      <div className="app-content">
        <div className="control-panel">
          <Space>
            <Button
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={togglePlay}
              type="primary"
            >
              {isPlaying ? '暂停' : '播放'}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
            >
              刷新
            </Button>
          </Space>
          <div className="time-slider">
            <Text strong style={{ marginBottom: 8, display: 'block' }}>
              时间: {formatTime(currentTime)}
            </Text>
            <Slider
              min={timeRange.min}
              max={timeRange.max}
              value={currentTime}
              onChange={handleTimeChange}
              disabled={timeRange.min === timeRange.max}
              tipFormatter={formatTime}
            />
          </div>
          <Space direction="vertical" size="small">
            <Text type="secondary">节点: {graphData.nodes.length}</Text>
            <Text type="secondary">连接: {graphData.edges.length}</Text>
            {abnormalCount > 0 && (
              <Text type="danger">
                <WarningOutlined /> 异常: {abnormalCount}
              </Text>
            )}
            {savingPos && <Text type="warning">保存中...</Text>}
          </Space>
        </div>
        <div className="topology-container">
          {loading && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
            }}>
              <Spin size="large" tip="加载拓扑数据..." />
            </div>
          )}
          <div ref={containerRef} className="topology-graph" />
          <div className="legend">
            <div className="legend-title">图例</div>
            <div className="legend-item">
              <div className="legend-color legend-tcp" />
              <span>TCP 连接</span>
            </div>
            <div className="legend-item">
              <div className="legend-color legend-udp" />
              <span>UDP 连接</span>
            </div>
            <div className="legend-divider" />
            <div className="legend-item">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
              <span>正常服务</span>
            </div>
            <div className="legend-item">
              <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
              <span>异常服务 (≥{ERROR_THRESHOLD * 100}%)</span>
            </div>
            <div className="legend-hint">
              点击节点固定/解锁位置
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
