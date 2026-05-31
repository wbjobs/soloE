import React from 'react';
import ReactECharts from 'echarts-for-react';

function Timeline({ transactions }) {
  const sortedTransactions = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

  const dates = sortedTransactions.map((tx, idx) => {
    const date = new Date(tx.timestamp * 1000);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  });

  const inflow = [];
  const outflow = [];

  sortedTransactions.forEach((tx, idx) => {
    const value = parseInt(tx.value) / 1e18;
    if (value > 0) {
      inflow.push(idx);
    }
  });

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: function(params) {
        const tx = sortedTransactions[params.dataIndex];
        const date = new Date(tx.timestamp * 1000);
        return `
          区块: ${tx.blockNumber}<br/>
          时间: ${date.toLocaleString()}<br/>
          Hash: ${tx.hash.substring(0, 10)}...<br/>
          ${tx.isNFT 
            ? `<span style="color:${tx.nftStandard === 'ERC-721' ? '#ff6b9d' : '#a29bfe'}">🎴 ${tx.nftStandard} NFT交易</span>` 
            : tx.isContractInteraction 
              ? '<span style="color:#f59e0b">⚡ 合约交互</span>' 
              : '普通交易'}
        `;
      }
    },
    xAxis: {
      type: 'category',
      data: sortedTransactions.map((_, idx) => idx + 1),
      axisLabel: {
        fontSize: 10
      },
      name: '交易序号'
    },
    yAxis: {
      type: 'time',
      axisLabel: {
        formatter: function(value) {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
      },
      name: '时间'
    },
    series: [
      {
        type: 'scatter',
        data: sortedTransactions.map((tx, idx) => ({
          value: [idx + 1, tx.timestamp * 1000],
          itemStyle: {
            color: tx.isNFT 
              ? (tx.nftStandard === 'ERC-721' ? '#ff6b9d' : '#a29bfe')
              : tx.isContractInteraction 
                ? '#f59e0b' 
                : '#667eea'
          },
          symbolSize: tx.isNFT ? 18 : tx.isContractInteraction ? 15 : 10
        }))
      }
    ]
  };

  return (
    <div style={{ height: '300px' }}>
      <ReactECharts option={option} style={{ height: '100%' }} />
    </div>
  );
}

export default Timeline;
