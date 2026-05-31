import React, { useState, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import SankeyChart from './components/SankeyChart';
import GasTrendChart from './components/GasTrendChart';
import TransactionList from './components/TransactionList';
import Timeline from './components/Timeline';

function App() {
  const [address, setAddress] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalTransactions, setTotalTransactions] = useState(0);

  const handleSearch = async () => {
    if (!address.trim()) {
      setError('请输入钱包地址');
      return;
    }

    setLoading(true);
    setError('');
    setCurrentPage(1);

    try {
      const [fullResponse, paginatedResponse] = await Promise.all([
        axios.get(`/api/transactions/${address}?limit=100`),
        axios.get(`/api/transactions/${address}/paginated?page=1&pageSize=${pageSize}`)
      ]);
      
      setAllTransactions(fullResponse.data.transactions);
      setTransactions(paginatedResponse.data.transactions);
      setTotalTransactions(paginatedResponse.data.total);
      setFromCache(fullResponse.data.fromCache);
    } catch (err) {
      setError(err.response?.data?.error || '获取交易数据失败');
      setTransactions([]);
      setAllTransactions([]);
      setTotalTransactions(0);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = useCallback(async (page) => {
    if (!address.trim() || page === currentPage) return;

    setListLoading(true);
    try {
      const response = await axios.get(
        `/api/transactions/${address}/paginated?page=${page}&pageSize=${pageSize}`
      );
      setTransactions(response.data.transactions);
      setTotalTransactions(response.data.total);
      setCurrentPage(page);
    } catch (err) {
      setError(err.response?.data?.error || '获取交易数据失败');
    } finally {
      setListLoading(false);
    }
  }, [address, currentPage, pageSize]);

  const handleRefresh = async () => {
    if (!address.trim()) return;

    setLoading(true);
    setError('');
    setCurrentPage(1);

    try {
      const [fullResponse, paginatedResponse] = await Promise.all([
        axios.get(`/api/transactions/${address}?refresh=true&limit=100`),
        axios.get(`/api/transactions/${address}/paginated?page=1&pageSize=${pageSize}`)
      ]);
      
      setAllTransactions(fullResponse.data.transactions);
      setTransactions(paginatedResponse.data.transactions);
      setTotalTransactions(paginatedResponse.data.total);
      setFromCache(false);
    } catch (err) {
      setError(err.response?.data?.error || '获取交易数据失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>以太坊交易追踪系统</h1>
        <p className="subtitle">Sepolia 测试网交易流向监控</p>
      </header>

      <div className="search-section">
        <div className="search-box">
          <input
            type="text"
            placeholder="输入钱包地址 (0x...)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            className="address-input"
          />
          <button onClick={handleSearch} disabled={loading} className="search-btn">
            {loading ? '查询中...' : '查询'}
          </button>
          {transactions.length > 0 && (
            <button onClick={handleRefresh} disabled={loading} className="refresh-btn">
              刷新数据
            </button>
          )}
        </div>
        {fromCache && <p className="cache-info">✓ 从缓存加载</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {allTransactions.length > 0 && (
        <div className="content">
          <div className="stats-bar">
            <div className="stat-item">
              <span className="stat-label">总交易数</span>
              <span className="stat-value">{totalTransactions}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">图表显示</span>
              <span className="stat-value">{allTransactions.length} 笔</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">合约交互</span>
              <span className="stat-value">
                {allTransactions.filter(t => t.isContractInteraction).length}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">NFT交易</span>
              <span className="stat-value stat-nft">
                {allTransactions.filter(t => t.isNFT).length}
              </span>
            </div>
          </div>

          <section className="chart-section">
            <h2>交易流向桑基图</h2>
            <SankeyChart transactions={allTransactions} currentAddress={address} />
          </section>

          <section className="chart-section">
            <h2>Gas 费用趋势</h2>
            <GasTrendChart transactions={allTransactions} />
          </section>

          <section className="chart-section">
            <h2>交易时间轴</h2>
            <Timeline transactions={allTransactions} />
          </section>

          <section className="list-section">
            <h2>交易详情</h2>
            <TransactionList 
              transactions={transactions} 
              currentAddress={address}
              total={totalTransactions}
              onPageChange={handlePageChange}
              currentPage={currentPage}
              pageSize={pageSize}
              loading={listLoading}
            />
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
