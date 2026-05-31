import { useState, useEffect, useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import axios from 'axios'
import BatteryGauge from './components/BatteryGauge'
import './App.css'

const nodeColors = {
  seller: '#4ade80',
  buyer: '#f87171',
  neutral: '#60a5fa',
}

const DECIMAL_PLACES = 4

const CustomNode = ({ data }) => {
  const netPower = data.net_power || 0
  const isSeller = netPower > 0.01
  const isBuyer = netPower < -0.01
  const nodeColor = isSeller ? nodeColors.seller : isBuyer ? nodeColors.buyer : nodeColors.neutral
  const hasBattery = data.has_battery

  return (
    <div className="custom-node" style={{ borderColor: nodeColor }}>
      <div className="node-header" style={{ background: nodeColor }}>
        {data.label}
        {hasBattery && <span className="battery-icon">🔋</span>}
      </div>
      <div className="node-body">
        <div className="node-info">
          <span className="info-label">发电:</span>
          <span className="info-value">{parseFloat(data.current_generation).toFixed(DECIMAL_PLACES)} kW</span>
        </div>
        <div className="node-info">
          <span className="info-label">负载:</span>
          <span className="info-value">{parseFloat(data.current_load).toFixed(DECIMAL_PLACES)} kW</span>
        </div>
        <div className="node-info net-power" style={{ color: nodeColor }}>
          <span className="info-label">净功率:</span>
          <span className="info-value">{netPower > 0 ? '+' : ''}{parseFloat(netPower).toFixed(DECIMAL_PLACES)} kW</span>
        </div>
        {hasBattery && (
          <div className="node-battery-section">
            <BatteryGauge
              socPercent={parseFloat(data.battery_soc_percent)}
              capacity={parseFloat(data.battery_capacity)}
              currentSoc={parseFloat(data.battery_soc)}
              charge={parseFloat(data.battery_charge) || 0}
              discharge={parseFloat(data.battery_discharge) || 0}
            />
          </div>
        )}
      </div>
      <div className="node-status">
        {isSeller && <span className="status-badge seller">卖方</span>}
        {isBuyer && <span className="status-badge buyer">买方</span>}
        {!isSeller && !isBuyer && <span className="status-badge neutral">平衡</span>}
      </div>
    </div>
  )
}

const nodeTypes = {
  custom: CustomNode,
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [gridState, setGridState] = useState(null)
  const [countdown, setCountdown] = useState(10)

  const fetchGridState = useCallback(async () => {
    try {
      const response = await axios.get('/api/grid-state/')
      return response.data
    } catch (error) {
      console.error('Error fetching grid state:', error)
      return null
    }
  }, [])

  const updateFlowData = useCallback((data) => {
    if (!data || !data.nodes) return

    const flowNodes = data.nodes.map((node) => ({
      id: node.node_id,
      type: 'custom',
      position: { x: node.position_x, y: node.position_y },
      data: {
        label: node.name,
        ...node,
        net_power: parseFloat(node.net_power),
        current_generation: parseFloat(node.current_generation),
        current_load: parseFloat(node.current_load),
        battery_soc: parseFloat(node.battery_soc),
        battery_capacity: parseFloat(node.battery_capacity),
        battery_soc_percent: parseFloat(node.battery_soc_percent),
        battery_charge: parseFloat(node.battery_charge),
        battery_discharge: parseFloat(node.battery_discharge),
        has_battery: node.has_battery,
      },
    }))

    const flowEdges = []
    if (data.transactions && data.transactions.length > 0) {
      data.transactions.forEach((trans, index) => {
        const sellerNode = data.nodes.find((n) => n.id === trans.seller)
        const buyerNode = data.nodes.find((n) => n.id === trans.buyer)
        if (sellerNode && buyerNode) {
          const quantity = parseFloat(trans.quantity)
          const price = parseFloat(trans.price)
          flowEdges.push({
            id: `edge-${index}-${Date.now()}`,
            source: sellerNode.node_id,
            target: buyerNode.node_id,
            animated: true,
            label: `${quantity.toFixed(DECIMAL_PLACES)} kWh @ ${price.toFixed(DECIMAL_PLACES)}元`,
            style: {
              stroke: '#4ade80',
              strokeWidth: 2 + Math.min(quantity, 5),
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#4ade80',
            },
            labelStyle: {
              fill: '#fff',
              fontSize: 12,
            },
            labelBgPadding: [4, 2],
            labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
          })
        }
      })
    }

    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [setNodes, setEdges])

  useEffect(() => {
    let isMounted = true

    const initData = async () => {
      const data = await fetchGridState()
      if (isMounted && data) {
        setGridState(data)
        updateFlowData(data)
      }
    }

    initData()

    return () => {
      isMounted = false
    }
  }, [fetchGridState, updateFlowData])

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchGridState()
      if (data) {
        setGridState(data)
        updateFlowData(data)
      }
      setCountdown(10)
    }, 10000)

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 10))
    }, 1000)

    return () => {
      clearInterval(interval)
      clearInterval(countdownInterval)
    }
  }, [fetchGridState, updateFlowData])

  const triggerAuction = async () => {
    try {
      await axios.post('/api/trigger-auction/')
      const data = await fetchGridState()
      if (data) {
        setGridState(data)
        updateFlowData(data)
      }
      setCountdown(10)
    } catch (error) {
      console.error('Error triggering auction:', error)
    }
  }

  const flowKey = useMemo(() => {
    if (!gridState) return 'initial'
    const nodeIds = gridState.nodes?.map((n) => `${n.node_id}-${n.net_power}`).join('-') || ''
    const transIds = gridState.transactions?.map((t) => `${t.seller}-${t.buyer}-${t.quantity}`).join('-') || ''
    return `${gridState.current_round}-${nodeIds}-${transIds}`
  }, [gridState])

  return (
    <div className="app-container">
      <div className="header">
        <h1>微电网P2P能量交易系统</h1>
        <div className="header-info">
          <div className="info-card">
            <span className="info-title">当前回合</span>
            <span className="info-value">{gridState?.current_round || 0}</span>
          </div>
          <div className="info-card">
            <span className="info-title">出清价格</span>
            <span className="info-value">
              {gridState?.latest_auction?.clearing_price
                ? parseFloat(gridState.latest_auction.clearing_price).toFixed(DECIMAL_PLACES)
                : '0.0000'} 元/kWh
            </span>
          </div>
          <div className="info-card">
            <span className="info-title">总交易量</span>
            <span className="info-value">
              {gridState?.latest_auction?.total_traded
                ? parseFloat(gridState.latest_auction.total_traded).toFixed(DECIMAL_PLACES)
                : '0.0000'} kWh
            </span>
          </div>
          <div className="info-card countdown">
            <span className="info-title">下次结算</span>
            <span className="info-value">{countdown} 秒</span>
          </div>
          <button className="auction-btn" onClick={triggerAuction}>
            立即结算
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="flow-container">
          <ReactFlow
            key={flowKey}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background variant="dots" gap={12} size={1} color="#334155" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeStrokeColor={(n) => {
                if (n.data?.net_power > 0.01) return '#4ade80'
                if (n.data?.net_power < -0.01) return '#f87171'
                return '#60a5fa'
              }}
              nodeColor="#1e293b"
              maskColor="rgba(0, 0, 0, 0.5)"
            />
          </ReactFlow>
        </div>

        <div className="sidebar">
          <div className="sidebar-title">节点详情</div>
          <div className="node-list">
            {gridState?.nodes?.map((node) => {
              const netPower = parseFloat(node.net_power) || 0
              const isSeller = netPower > 0.01
              const isBuyer = netPower < -0.01
              const batterySoc = parseFloat(node.battery_soc)
              const batteryCapacity = parseFloat(node.battery_capacity)
              const batteryPercent = (batterySoc / batteryCapacity) * 100
              const batteryCharge = parseFloat(node.battery_charge) || 0
              const batteryDischarge = parseFloat(node.battery_discharge) || 0
              return (
                <div key={node.node_id} className="node-item">
                  <div
                    className="node-indicator"
                    style={{
                      background: isSeller
                        ? nodeColors.seller
                        : isBuyer
                        ? nodeColors.buyer
                        : nodeColors.neutral,
                    }}
                  />
                  <div className="node-item-info">
                    <div className="node-item-name">
                      {node.name}
                      {node.has_battery && <span className="battery-badge">🔋</span>}
                    </div>
                    <div className="node-item-stats">
                      <span>发电: {parseFloat(node.current_generation).toFixed(DECIMAL_PLACES)} kW</span>
                      <span>负载: {parseFloat(node.current_load).toFixed(DECIMAL_PLACES)} kW</span>
                    </div>
                    <div
                      className="node-item-net"
                      style={{
                        color: isSeller
                          ? nodeColors.seller
                          : isBuyer
                          ? nodeColors.buyer
                          : nodeColors.neutral,
                      }}
                    >
                      净功率: {netPower > 0 ? '+' : ''}
                      {netPower.toFixed(DECIMAL_PLACES)} kW
                    </div>
                    {node.has_battery && (
                      <div className="node-item-battery">
                        <div className="battery-bar-container">
                          <div
                            className="battery-bar-fill"
                            style={{
                              width: `${Math.min(100, batteryPercent)}%`,
                              background: batteryPercent > 60 ? '#4ade80' : batteryPercent > 30 ? '#fbbf24' : '#f87171'
                            }}
                          />
                        </div>
                        <span className="battery-bar-text">
                          {batterySoc.toFixed(2)}/{batteryCapacity.toFixed(0)} kWh
                          {batteryCharge > 0.001 && <span className="battery-charging"> ⚡+{batteryCharge.toFixed(2)}</span>}
                          {batteryDischarge > 0.001 && <span className="battery-discharging"> 🔋-{batteryDischarge.toFixed(2)}</span>}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {gridState?.transactions?.length > 0 && (
            <div className="transactions-section">
              <div className="sidebar-title">当前交易</div>
              <div className="transaction-list">
                {gridState.transactions.map((trans, index) => {
                  const quantity = parseFloat(trans.quantity)
                  const price = parseFloat(trans.price)
                  const total = quantity * price
                  return (
                    <div key={`${index}-${trans.seller}-${trans.buyer}`} className="transaction-item">
                      <div className="transaction-flow">
                        <span className="seller">{trans.seller_name}</span>
                        <span className="arrow">→</span>
                        <span className="buyer">{trans.buyer_name}</span>
                      </div>
                      <div className="transaction-details">
                        <span>{quantity.toFixed(DECIMAL_PLACES)} kWh</span>
                        <span className="price">@{price.toFixed(DECIMAL_PLACES)}元</span>
                        <span className="total">
                          = {total.toFixed(DECIMAL_PLACES)}元
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="legend">
            <div className="legend-title">图例</div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: nodeColors.seller }} />
              <span>卖方 (发电 {'>'} 负载)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: nodeColors.buyer }} />
              <span>买方 (发电 {'<'} 负载)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: nodeColors.neutral }} />
              <span>平衡 (发电 ≈ 负载)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
