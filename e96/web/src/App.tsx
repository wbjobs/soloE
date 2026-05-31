import React, { useState, useEffect } from 'react';
import { getSocket, disconnectSocket } from './socket';
import { MigrationStats, MigrationProgress, Config } from './types';
import { StatsOverview } from './components/StatsOverview';
import { TableCard } from './components/TableCard';
import { LogPanel } from './components/LogPanel';
import { Loader, Wifi, WifiOff } from 'lucide-react';

const App: React.FC = () => {
  const [stats, setStats] = useState<MigrationStats | null>(null);
  const [progressList, setProgressList] = useState<MigrationProgress[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => {
      setConnected(true);
      setLoading(false);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('stats', (data: MigrationStats) => {
      setStats(data);
    });

    socket.on('progress', (data: MigrationProgress) => {
      setProgressList(prev => {
        const existing = prev.findIndex(p => p.tableName === data.tableName);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = data;
          return updated;
        }
        return [...prev, data];
      });
    });

    socket.on('log', (data: string) => {
      setLogs(prev => [...prev, data].slice(-200));
    });

    socket.on('logs', (data: string[]) => {
      setLogs(data.slice(-200));
    });

    socket.on('complete', () => {
      setLogs(prev => [...prev, '[INFO] 迁移任务已全部完成！']);
    });

    socket.on('error', (error: { message: string }) => {
      setLogs(prev => [...prev, `[ERROR] ${error.message}`]);
    });

    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to load config:', err));

    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setProgressList(data.tables);
      })
      .catch(err => console.error('Failed to load stats:', err));

    return () => {
      disconnectSocket();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader size={48} className="animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">正在连接服务器...</p>
        </div>
      </div>
    );
  }

  const defaultStats: MigrationStats = stats || {
    totalTables: config?.tables.length || 0,
    completedTables: 0,
    totalRows: 0,
    totalMigratedRows: 0,
    totalFailedRows: 0,
    totalValidatedRows: 0,
    totalValidationFailedRows: 0,
    startTime: 0,
    elapsedTime: 0,
    tables: []
  };

  const displayProgress = progressList.length > 0 
    ? progressList 
    : (config?.tables.map(t => ({
        tableName: t.source,
        totalRows: 0,
        migratedRows: 0,
        failedRows: 0,
        validatedRows: 0,
        validationFailedRows: 0,
        status: 'pending',
        elapsedTime: 0,
        estimatedRemainingTime: 0,
        rowsPerSecond: 0
      })) || []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {connected ? (
              <span className="flex items-center gap-1 text-green-600 text-sm">
                <Wifi size={18} />
                已连接
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-600 text-sm">
                <WifiOff size={18} />
                已断开
              </span>
            )}
          </div>
        </div>

        <StatsOverview stats={defaultStats} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {displayProgress.map((progress, index) => (
            <TableCard key={progress.tableName || index} progress={progress} />
          ))}
        </div>

        <LogPanel logs={logs} />

        <footer className="mt-6 text-center text-gray-500 text-sm">
          数据迁移校验工具 v1.0 | 支持断点续传、限速、并发控制
        </footer>
      </div>
    </div>
  );
};

export default App;
