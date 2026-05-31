import { TransferProgress } from '../components/TransferProgress';
import { useAppStore } from '../store';

export function Transfer() {
  const { transfers, updateTransfer } = useAppStore();

  const activeTransfers = transfers.filter(
    (t) => t.status === 'pending' || t.status === 'transferring' || t.status === 'paused'
  );

  const completedTransfers = transfers.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );

  const handlePause = (transferId: string) => {
    updateTransfer(transferId, { status: 'paused' });
  };

  const handleResume = (transferId: string) => {
    updateTransfer(transferId, { status: 'transferring' });
  };

  const handleCancel = (transferId: string) => {
    updateTransfer(transferId, { status: 'cancelled' });
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">传输队列</h1>
          <p className="text-dark-300">查看和管理当前的文件传输</p>
        </div>

        {activeTransfers.length > 0 ? (
          <div className="space-y-4 mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">进行中 ({activeTransfers.length})</h2>
            {activeTransfers.map((task) => (
              <TransferProgress
                key={task.id}
                task={task}
                onPause={() => handlePause(task.id)}
                onResume={() => handleResume(task.id)}
                onCancel={() => handleCancel(task.id)}
              />
            ))}
          </div>
        ) : (
          <div className="card p-12 text-center mb-8">
            <div className="w-20 h-20 rounded-2xl bg-dark-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">没有正在进行的传输</h3>
            <p className="text-dark-300">在设备列表中选择设备开始传输文件</p>
          </div>
        )}

        {completedTransfers.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-4">已完成 ({completedTransfers.length})</h2>
            {completedTransfers.slice(0, 5).map((task) => (
              <TransferProgress key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
