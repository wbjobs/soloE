import React from 'react';
import ReactECharts from 'echarts-for-react';

function GasTrendChart({ transactions }) {
  const sortedTransactions = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

  const dates = sortedTransactions.map(tx => {
    const date = new Date(tx.timestamp * 1000);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  });

  const gasPrices = sortedTransactions.map(tx => parseInt(tx.gasPrice) / 1e9);
  const gasUsed = sortedTransactions.map(tx => tx.gasUsed);
  const contractMarkers = sortedTransactions.map(tx => tx.isContractInteraction);

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        const idx = params[0].dataIndex;
        const tx = transactions[idx];
        return `${dates[idx]}<br/>
          Gas Price: ${gasPrices[idx].toFixed(4)} Gwei<br/>
          Gas Used: ${gasUsed[idx]}<br/>
          ${tx.isNFT 
            ? `<span style="color:${tx.nftStandard === 'ERC-721' ? '#ff6b9d' : '#a29bfe'}">🎴 ${tx.nftStandard} NFT交易</span>` 
            : tx.isContractInteraction 
              ? '<span style="color:#f59e0b">⚡ 合约交互</span>' 
              : '普通交易'}`;
      }
    },
    legend: {
      data: ['Gas Price (Gwei)', 'Gas Used'],
      top: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLabel: {
        rotate: 45,
        fontSize: 10
      }
    },
    yAxis: [
      {
        type: 'value',
        name: 'Gas Price (Gwei)',
        position: 'left',
        axisLine: { show: true },
        splitLine: { show: true }
      },
      {
        type: 'value',
        name: 'Gas Used',
        position: 'right',
        axisLine: { show: true },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'Gas Price (Gwei)',
        type: 'line',
        smooth: true,
        data: gasPrices,
        itemStyle: {
          color: '#667eea'
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(102, 126, 234, 0.3)' },
              { offset: 1, color: 'rgba(102, 126, 234, 0.05)' }
            ]
          }
        },
        markPoint: {
          data: contractMarkers
            .map((isContract, idx) => isContract ? { coord: [idx, gasPrices[idx]], value: '合约' } : null)
            .filter(Boolean),
          symbol: 'circle',
          symbolSize: 10,
          itemStyle: {
            color: '#f59e0b'
          },
          label: {
            show: false
          }
        }
      },
      {
        name: 'Gas Used',
        type: 'bar',
        yAxisIndex: 1,
        data: gasUsed,
        itemStyle: {
          color: 'rgba(118, 75, 162, 0.6)'
        }
      }
    ]
  };

  return (
    <div style={{ height: '400px' }}>
      <ReactECharts option={option} style={{ height: '100%' }} />
    </div>
  );
}

export default GasTrendChart;
