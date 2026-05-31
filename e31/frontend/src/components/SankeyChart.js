import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';

const MAX_DISPLAY_NODES = 15;
const MIN_DISPLAY_VALUE = 0.001;

function SankeyChart({ transactions, currentAddress }) {
  const address = currentAddress.toLowerCase();
  const [showAll, setShowAll] = useState(false);

  const { aggregatedLinks, addressStats } = useMemo(() => {
    const inflowMap = new Map();
    const outflowMap = new Map();

    transactions.forEach(tx => {
      const from = tx.from.toLowerCase();
      const to = tx.to ? tx.to.toLowerCase() : '0x0';
      const value = parseInt(tx.value) / 1e18;

      if (from === address) {
        const key = to;
        if (!outflowMap.has(key)) {
          outflowMap.set(key, { value: 0, count: 0, isContract: false, isNFT: false, nftStandard: null });
        }
        const stat = outflowMap.get(key);
        stat.value += value;
        stat.count += 1;
        stat.isContract = stat.isContract || tx.isContractInteraction;
        stat.isNFT = stat.isNFT || tx.isNFT;
        if (tx.isNFT) stat.nftStandard = tx.nftStandard;
      } else if (to === address) {
        const key = from;
        if (!inflowMap.has(key)) {
          inflowMap.set(key, { value: 0, count: 0, isContract: false, isNFT: false, nftStandard: null });
        }
        const stat = inflowMap.get(key);
        stat.value += value;
        stat.count += 1;
        stat.isContract = stat.isContract || tx.isContractInteraction;
        stat.isNFT = stat.isNFT || tx.isNFT;
        if (tx.isNFT) stat.nftStandard = tx.nftStandard;
      }
    });

    const allLinks = [];
    
    inflowMap.forEach((stat, addr) => {
      allLinks.push({
        source: addr,
        target: address,
        value: stat.value,
        count: stat.count,
        isContract: stat.isContract,
        isNFT: stat.isNFT,
        nftStandard: stat.nftStandard,
        direction: 'in'
      });
    });

    outflowMap.forEach((stat, addr) => {
      allLinks.push({
        source: address,
        target: addr,
        value: stat.value,
        count: stat.count,
        isContract: stat.isContract,
        isNFT: stat.isNFT,
        nftStandard: stat.nftStandard,
        direction: 'out'
      });
    });

    allLinks.sort((a, b) => b.value - a.value);

    return {
      aggregatedLinks: allLinks,
      addressStats: {
        inflowCount: inflowMap.size,
        outflowCount: outflowMap.size,
        totalLinks: allLinks.length,
        nftCount: allLinks.filter(l => l.isNFT).length
      }
    };
  }, [transactions, address]);

  const { displayLinks, othersInflow, othersOutflow } = useMemo(() => {
    if (showAll || addressStats.totalLinks <= MAX_DISPLAY_NODES) {
      return {
        displayLinks: aggregatedLinks,
        othersInflow: null,
        othersOutflow: null
      };
    }

    const topLinks = aggregatedLinks.slice(0, MAX_DISPLAY_NODES);
    const restLinks = aggregatedLinks.slice(MAX_DISPLAY_NODES);

    const othersInflow = restLinks
      .filter(l => l.direction === 'in')
      .reduce((acc, l) => ({ value: acc.value + l.value, count: acc.count + l.count }, { value: 0, count: 0 }));
    
    const othersOutflow = restLinks
      .filter(l => l.direction === 'out')
      .reduce((acc, l) => ({ value: acc.value + l.value, count: acc.count + l.count }, { value: 0, count: 0 }));

    return {
      displayLinks: topLinks,
      othersInflow: othersInflow.count > 0 ? othersInflow : null,
      othersOutflow: othersOutflow.count > 0 ? othersOutflow : null
    };
  }, [aggregatedLinks, addressStats, showAll]);

  const { nodes, links } = useMemo(() => {
    const nodeSet = new Set([address]);
    const linkList = [];

    displayLinks.forEach(link => {
      nodeSet.add(link.source);
      nodeSet.add(link.target);
      
      linkList.push({
        source: link.source,
        target: link.target,
        value: Math.max(link.value, MIN_DISPLAY_VALUE),
        actualValue: link.value,
        count: link.count,
        isContract: link.isContract,
        isNFT: link.isNFT,
        nftStandard: link.nftStandard,
        lineStyle: {
          color: link.isNFT 
            ? (link.nftStandard === 'ERC-721' ? '#ff6b9d' : '#a29bfe')
            : link.isContract 
              ? '#f59e0b' 
              : '#667eea'
        }
      });
    });

    if (othersInflow) {
      nodeSet.add('OTHERS_IN');
      linkList.push({
        source: 'OTHERS_IN',
        target: address,
        value: Math.max(othersInflow.value, MIN_DISPLAY_VALUE),
        actualValue: othersInflow.value,
        count: othersInflow.count,
        isContract: false,
        isNFT: false,
        lineStyle: {
          color: '#9ca3af'
        }
      });
    }

    if (othersOutflow) {
      nodeSet.add('OTHERS_OUT');
      linkList.push({
        source: address,
        target: 'OTHERS_OUT',
        value: Math.max(othersOutflow.value, MIN_DISPLAY_VALUE),
        actualValue: othersOutflow.value,
        count: othersOutflow.count,
        isContract: false,
        isNFT: false,
        lineStyle: {
          color: '#9ca3af'
        }
      });
    }

    const nodeList = Array.from(nodeSet).map(node => {
      let name;
      if (node === address) name = '当前地址';
      else if (node === 'OTHERS_IN') name = '其他流入';
      else if (node === 'OTHERS_OUT') name = '其他流出';
      else name = node.substring(0, 8) + '...';
      
      return { name, fullName: node };
    });

    const finalLinks = linkList.map(link => ({
      ...link,
      source: link.source === address ? '当前地址' : 
              link.source === 'OTHERS_IN' ? '其他流入' :
              link.source === 'OTHERS_OUT' ? '其他流出' :
              link.source.substring(0, 8) + '...',
      target: link.target === address ? '当前地址' :
              link.target === 'OTHERS_IN' ? '其他流入' :
              link.target === 'OTHERS_OUT' ? '其他流出' :
              link.target.substring(0, 8) + '...'
    }));

    return { nodes: nodeList, links: finalLinks };
  }, [displayLinks, othersInflow, othersOutflow, address]);

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: function(params) {
        if (params.dataType === 'edge') {
          const data = params.data;
          return `${data.source} → ${data.target}<br/>
            金额: ${data.actualValue.toFixed(6)} ETH<br/>
            交易笔数: ${data.count}`;
        }
        return params.name;
      }
    },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        emphasis: {
          focus: 'adjacency'
        },
        data: nodes,
        links: links,
        lineStyle: {
          curveness: 0.5
        },
        label: {
          fontSize: 11
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: '#aaa'
        }
      }
    ]
  };

  return (
    <div style={{ height: '500px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '0 10px 10px'
      }}>
        <div style={{ fontSize: '12px', color: '#666' }}>
          共 {addressStats.totalLinks} 个交易对手 (流入: {addressStats.inflowCount}, 流出: {addressStats.outflowCount})
        </div>
        {addressStats.totalLinks > MAX_DISPLAY_NODES && (
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              border: '1px solid #667eea',
              background: showAll ? '#667eea' : 'white',
              color: showAll ? 'white' : '#667eea',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {showAll ? '显示前15个' : '显示全部'}
          </button>
        )}
      </div>
      
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts 
          option={option} 
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
      
      <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
        <span style={{ display: 'inline-block', margin: '0 8px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#667eea', marginRight: '5px', verticalAlign: 'middle', borderRadius: '2px' }}></span>
          普通交易
        </span>
        <span style={{ display: 'inline-block', margin: '0 8px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#f59e0b', marginRight: '5px', verticalAlign: 'middle', borderRadius: '2px' }}></span>
          合约交互
        </span>
        <span style={{ display: 'inline-block', margin: '0 8px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'linear-gradient(135deg, #ff6b9d 0%, #c44569 100%)', marginRight: '5px', verticalAlign: 'middle', borderRadius: '2px' }}></span>
          ERC-721 (NFT)
        </span>
        <span style={{ display: 'inline-block', margin: '0 8px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'linear-gradient(135deg, #a29bfe 0%, #6c5ce7 100%)', marginRight: '5px', verticalAlign: 'middle', borderRadius: '2px' }}></span>
          ERC-1155 (NFT)
        </span>
        <span style={{ display: 'inline-block', margin: '0 8px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#9ca3af', marginRight: '5px', verticalAlign: 'middle', borderRadius: '2px' }}></span>
          其他聚合
        </span>
      </div>
    </div>
  );
}

export default SankeyChart;
