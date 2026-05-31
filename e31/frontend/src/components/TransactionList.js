import React, { useState, useCallback, useRef, useEffect } from 'react';

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const VIRTUAL_SCROLL_THRESHOLD = 100;

function TransactionList({ 
  transactions, 
  currentAddress, 
  total = transactions.length,
  onPageChange,
  currentPage = 1,
  pageSize = 20,
  loading = false
}) {
  const address = currentAddress.toLowerCase();
  const containerRef = useRef(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: pageSize });
  const rowHeight = 48;

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatValue = (value) => {
    const eth = parseInt(value) / 1e18;
    return eth.toFixed(6);
  };

  const formatGasPrice = (gasPrice) => {
    const gwei = parseInt(gasPrice) / 1e9;
    return gwei.toFixed(4) + ' Gwei';
  };

  const truncateAddress = (addr) => {
    if (!addr) return '-';
    return addr.substring(0, 10) + '...';
  };

  const totalPages = Math.ceil(total / pageSize);
  const baseIdx = (currentPage - 1) * pageSize;

  const renderPageButtons = useCallback(() => {
    const buttons = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
      buttons.push(
        <button key="first" onClick={() => onPageChange(1)} className="page-btn">1</button>
      );
      if (startPage > 2) {
        buttons.push(<span key="ellipsis1" className="page-ellipsis">...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button 
          key={i} 
          onClick={() => onPageChange(i)} 
          className={`page-btn ${i === currentPage ? 'active' : ''}`}
        >
          {i}
        </button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        buttons.push(<span key="ellipsis2" className="page-ellipsis">...</span>);
      }
      buttons.push(
        <button key="last" onClick={() => onPageChange(totalPages)} className="page-btn">{totalPages}</button>
      );
    }

    return buttons;
  }, [currentPage, totalPages, onPageChange]);

  return (
    <div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '12px',
        padding: '0 4px'
      }}>
        <div style={{ fontSize: '13px', color: '#666' }}>
          共 <strong>{total}</strong> 条交易记录
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>每页显示:</span>
          <select 
            value={pageSize}
            onChange={(e) => {
              onPageChange(1);
            }}
            style={{
              padding: '4px 8px',
              fontSize: '13px',
              border: '1px solid #ddd',
              borderRadius: '4px'
            }}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size} 条</option>
            ))}
          </select>
        </div>
      </div>

      <div 
        ref={containerRef} 
        style={{ 
          overflowX: 'auto',
          maxHeight: '500px',
          overflowY: 'auto'
        }}
      >
        <table className="transaction-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ width: '50px' }}>#</th>
              <th style={{ width: '150px' }}>时间</th>
              <th style={{ width: '80px' }}>类型</th>
              <th style={{ width: '120px' }}>对方地址</th>
              <th style={{ width: '120px' }}>金额 (ETH)</th>
              <th style={{ width: '120px' }}>Gas Price</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                  <div style={{ color: '#666' }}>加载中...</div>
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                  <div style={{ color: '#999' }}>暂无交易数据</div>
                </td>
              </tr>
            ) : (
              transactions.map((tx, idx) => {
                const from = tx.from.toLowerCase();
                const to = tx.to ? tx.to.toLowerCase() : '';
                const isInflow = to === address;
                const isOutflow = from === address;
                const otherAddress = isInflow ? tx.from : tx.to;

                return (
              <tr
                key={tx.hash}
                className={`transaction-row ${tx.isNFT ? 'nft-transaction' : ''} ${tx.isContractInteraction ? 'contract-interaction' : ''}`}
                style={{ height: rowHeight }}
              >
                <td>{baseIdx + idx + 1}</td>
                <td>{formatDate(tx.timestamp)}</td>
                <td>
                  {tx.isNFT ? (
                    <span className={`badge nft-${tx.nftStandard === 'ERC-721' ? '721' : '1155'}`}>
                      {tx.nftStandard}
                    </span>
                  ) : tx.isContractInteraction ? (
                    <span className="badge contract">合约交互</span>
                  ) : isInflow ? (
                    <span className="badge inflow">转入</span>
                  ) : (
                    <span className="badge outflow">转出</span>
                  )}
                </td>
                    <td title={otherAddress}>
                      {otherAddress ? (
                        <a
                          href={`https://sepolia.etherscan.io/address/${otherAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hash-link"
                        >
                          {truncateAddress(otherAddress)}
                        </a>
                      ) : '-'}
                    </td>
                    <td>{formatValue(tx.value)}</td>
                    <td>{formatGasPrice(tx.gasPrice)}</td>
                    <td>
                      <a
                        href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hash-link"
                        title={tx.hash}
                      >
                        {tx.hash.substring(0, 12)}...
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          gap: '6px',
          marginTop: '16px'
        }}>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1 || loading}
            className="page-btn"
          >
            上一页
          </button>
          
          {renderPageButtons()}
          
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages || loading}
            className="page-btn"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

export default TransactionList;
