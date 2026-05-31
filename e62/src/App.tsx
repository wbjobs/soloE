import { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import {
  Play,
  Download,
  Upload,
  Cpu,
  Zap,
  Gpu,
  Calculator,
  BarChart3,
  Layers,
  Clock,
} from 'lucide-react';
import Papa from 'papaparse';

import { useMatrixStore } from './store/matrixStore';
import type { WorkerApi } from './workers/matrix.worker';
import type { CSRMatrix } from './types';
import { matrixToCSV, csvToMatrix } from './utils/matrix';
import { MatrixHeatmap } from './components/MatrixHeatmap';

function App() {
  const {
    matrixA,
    matrixB,
    result,
    svdResult,
    eigenResult,
    isComputing,
    progress,
    computeEngine,
    useFP16,
    svdRank,
    eigenCount,
    operationMode,
    history,
    webgpuAvailable,
    wasmAvailable,
    setMatrixA,
    setMatrixB,
    setResult,
    setSVDResult,
    setEigenResult,
    setIsComputing,
    setProgress,
    setComputeEngine,
    setUseFP16,
    setSvdRank,
    setEigenCount,
    setOperationMode,
    setWebgpuAvailable,
    setWasmAvailable,
    generateRandomMatrices,
    addToHistory,
    clearAllResults,
  } = useMatrixStore();

  const workerRef = useRef<Comlink.Remote<WorkerApi> | null>(null);
  const [matrixSize, setMatrixSize] = useState(200);
  const [density, setDensity] = useState(0.05);
  const [activeTab, setActiveTab] = useState<'result' | 'visualization'>('result');

  useEffect(() => {
    const worker = new Worker(
      new URL('./workers/matrix.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = Comlink.wrap<WorkerApi>(worker);

    workerRef.current.isWebGPUAvailable().then(setWebgpuAvailable);
    workerRef.current.isWASMAvailable().then(setWasmAvailable);

    return () => worker.terminate();
  }, []);

  const handleCompute = async () => {
    if (!workerRef.current || !matrixA) return;
    if (operationMode === 'multiply' && !matrixB) return;

    setIsComputing(true);
    setProgress(0);
    clearAllResults();

    try {
      const progressCallback = Comlink.proxy((p: number) => setProgress(p));

      if (operationMode === 'multiply') {
        const computeResult = await workerRef.current.multiply(
          matrixA,
          matrixB!,
          computeEngine,
          useFP16,
          progressCallback
        );

        setResult(computeResult);

        addToHistory({
          id: Date.now().toString(),
          matrixA: {
            id: 'a',
            name: 'Matrix A',
            rows: matrixA.rows,
            cols: matrixA.cols,
            nnz: matrixA.nnz,
            density: matrixA.nnz / (matrixA.rows * matrixA.cols),
            createdAt: new Date().toISOString(),
          },
          matrixB: {
            id: 'b',
            name: 'Matrix B',
            rows: matrixB!.rows,
            cols: matrixB!.cols,
            nnz: matrixB!.nnz,
            density: matrixB!.nnz / (matrixB!.rows * matrixB!.cols),
            createdAt: new Date().toISOString(),
          },
          result: {
            id: 'result',
            name: 'Result',
            rows: computeResult.matrixC.rows,
            cols: computeResult.matrixC.cols,
            nnz: computeResult.matrixC.nnz,
            density: computeResult.matrixC.nnz /
              (computeResult.matrixC.rows * computeResult.matrixC.cols),
            createdAt: new Date().toISOString(),
          },
          engine: computeEngine,
          duration: computeResult.duration,
          createdAt: new Date().toISOString(),
        });
      } else if (operationMode === 'svd') {
        const svdResultData = await workerRef.current.computeSVD(
          matrixA,
          svdRank,
          progressCallback
        );
        setSVDResult(svdResultData);
      } else if (operationMode === 'eigen') {
        const eigenResultData = await workerRef.current.computeEigenvalues(
          matrixA,
          eigenCount,
          progressCallback
        );
        setEigenResult(eigenResultData);
      }
    } catch (error) {
      console.error('Compute error:', error);
    } finally {
      setIsComputing(false);
    }
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setMatrix: (matrix: CSRMatrix) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as string[][];
        const csv = data.map((row) => row.join(',')).join('\n');
        const matrix = csvToMatrix(csv);
        setMatrix(matrix);
      },
    });
  };

  const handleDownload = (matrix: CSRMatrix, name: string) => {
    const csv = matrixToCSV(matrix);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleGenerate = () => {
    generateRandomMatrices(matrixSize, density);
  };

  const getEngineLabel = (engine: string) => {
    if (engine === 'webgpu') return 'WebGPU';
    if (engine === 'wasm') return 'WASM + Rayon';
    return 'JavaScript';
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calculator className="w-8 h-8 text-blue-500" />
            <h1 className="text-2xl font-bold">稀疏矩阵高性能计算平台</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className={`px-2 py-1 rounded ${wasmAvailable ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-500'}`}>
              WASM: {wasmAvailable ? '✓' : '✗'}
            </span>
            <span className={`px-2 py-1 rounded ${webgpuAvailable ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-500'}`}>
              WebGPU: {webgpuAvailable ? '✓' : '✗'}
            </span>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* 左侧控制面板 */}
          <div className="col-span-3 space-y-6">
            {/* 矩阵生成 */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-500" />
                矩阵生成
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">
                    矩阵大小: {matrixSize}×{matrixSize}
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="2000"
                    step="50"
                    value={matrixSize}
                    onChange={(e) => setMatrixSize(Number(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">
                    稀疏度: {(density * 100).toFixed(1)}%
                  </label>
                  <input
                    type="range"
                    min="0.01"
                    max="0.5"
                    step="0.01"
                    value={density}
                    onChange={(e) => setDensity(Number(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isComputing}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
                >
                  生成随机矩阵
                </button>
              </div>
            </div>

            {/* 运算模式 */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-purple-500" />
                运算模式
              </h2>
              <div className="space-y-2">
                {[
                  { mode: 'multiply', label: '矩阵乘法', icon: Zap },
                  { mode: 'svd', label: 'SVD 分解', icon: Layers },
                  { mode: 'eigen', label: '特征值计算', icon: BarChart3 },
                ].map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setOperationMode(mode as any);
                      clearAllResults();
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${operationMode === mode ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 计算引擎 */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-green-500" />
                计算引擎
              </h2>
              <div className="space-y-2">
                <label className={`flex items-center gap-3 cursor-pointer p-2 rounded-lg ${computeEngine === 'js' ? 'bg-slate-700' : 'hover:bg-slate-700/50'}`}>
                  <input
                    type="radio"
                    name="engine"
                    value="js"
                    checked={computeEngine === 'js'}
                    onChange={() => setComputeEngine('js')}
                    disabled={isComputing}
                    className="w-4 h-4"
                  />
                  <Cpu className="w-5 h-5 text-yellow-500" />
                  <div>
                    <div className="font-medium">JavaScript</div>
                    <div className="text-xs text-slate-400">单线程，无需编译</div>
                  </div>
                </label>
                <label className={`flex items-center gap-3 cursor-pointer p-2 rounded-lg ${computeEngine === 'wasm' ? 'bg-slate-700' : 'hover:bg-slate-700/50'} ${!wasmAvailable ? 'opacity-50' : ''}`}>
                  <input
                    type="radio"
                    name="engine"
                    value="wasm"
                    checked={computeEngine === 'wasm'}
                    onChange={() => setComputeEngine('wasm')}
                    disabled={isComputing || !wasmAvailable}
                    className="w-4 h-4"
                  />
                  <Zap className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="font-medium">WASM + Rayon</div>
                    <div className="text-xs text-slate-400">多线程并行计算</div>
                  </div>
                </label>
                <label className={`flex items-center gap-3 cursor-pointer p-2 rounded-lg ${computeEngine === 'webgpu' ? 'bg-slate-700' : 'hover:bg-slate-700/50'} ${!webgpuAvailable ? 'opacity-50' : ''}`}>
                  <input
                    type="radio"
                    name="engine"
                    value="webgpu"
                    checked={computeEngine === 'webgpu'}
                    onChange={() => setComputeEngine('webgpu')}
                    disabled={isComputing || !webgpuAvailable}
                    className="w-4 h-4"
                  />
                  <Gpu className="w-5 h-5 text-green-500" />
                  <div>
                    <div className="font-medium">WebGPU 加速</div>
                    <div className="text-xs text-slate-400">GPU 并行计算</div>
                  </div>
                </label>
              </div>

              {computeEngine === 'webgpu' && webgpuAvailable && (
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-slate-300">FP16 混合精度</span>
                    <input
                      type="checkbox"
                      checked={useFP16}
                      onChange={(e) => setUseFP16(e.target.checked)}
                      className="w-5 h-5 rounded accent-green-500"
                    />
                  </label>
                </div>
              )}

              {(operationMode === 'svd' || operationMode === 'eigen') && (
                <div className="mt-4 pt-4 border-t border-slate-700 space-y-3">
                  {operationMode === 'svd' && (
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        SVD 秩: {svdRank}
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="50"
                        step="1"
                        value={svdRank}
                        onChange={(e) => setSvdRank(Number(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                  {operationMode === 'eigen' && (
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        特征值数量: {eigenCount}
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="50"
                        step="1"
                        value={eigenCount}
                        onChange={(e) => setEigenCount(Number(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 计算按钮 */}
            <button
              onClick={handleCompute}
              disabled={
                isComputing ||
                !matrixA ||
                (operationMode === 'multiply' && !matrixB)
              }
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg text-lg"
            >
              <Play className="w-6 h-6" />
              {isComputing ? `计算中 ${progress}%` : '开始计算'}
            </button>
          </div>

          {/* 中间结果区 */}
          <div className="col-span-6 space-y-6">
            {/* 进度条 */}
            {isComputing && (
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-400">计算进度</span>
                  <span className="text-sm font-medium text-green-400">{progress}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 via-green-500 to-emerald-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* 矩阵信息卡片 */}
            <div className="grid grid-cols-2 gap-4">
              {matrixA && (
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-blue-400">矩阵 A</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => document.getElementById('fileA')?.click()}
                        className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                        title="上传CSV"
                      >
                        <Upload className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(matrixA, 'matrix-a')}
                        className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                        title="下载CSV"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    id="fileA"
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileUpload(e, setMatrixA)}
                    className="hidden"
                  />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">大小:</span>
                      <span className="font-mono">{matrixA.rows} × {matrixA.cols}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">非零元素:</span>
                      <span className="font-mono">{matrixA.nnz.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">密度:</span>
                      <span className="font-mono">{((matrixA.nnz / (matrixA.rows * matrixA.cols)) * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              )}

              {matrixB && operationMode === 'multiply' && (
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-purple-400">矩阵 B</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => document.getElementById('fileB')?.click()}
                        className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                        title="上传CSV"
                      >
                        <Upload className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(matrixB, 'matrix-b')}
                        className="p-1.5 hover:bg-slate-700 rounded transition-colors"
                        title="下载CSV"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    id="fileB"
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileUpload(e, setMatrixB)}
                    className="hidden"
                  />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">大小:</span>
                      <span className="font-mono">{matrixB.rows} × {matrixB.cols}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">非零元素:</span>
                      <span className="font-mono">{matrixB.nnz.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">密度:</span>
                      <span className="font-mono">{((matrixB.nnz / (matrixB.rows * matrixB.cols)) * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 结果 Tab */}
            {(result || svdResult || eigenResult) && (
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <div className="flex gap-2 mb-4 border-b border-slate-700 pb-3">
                  {result && (
                    <button
                      onClick={() => setActiveTab('result')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'result' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      计算结果
                    </button>
                  )}
                  {(result || svdResult) && (
                    <button
                      onClick={() => setActiveTab('visualization')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'visualization' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      热力图可视化
                    </button>
                  )}
                </div>

                {activeTab === 'result' && result && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-green-400 flex items-center gap-2">
                        <Gpu className="w-5 h-5" />
                        计算结果
                      </h3>
                      <button
                        onClick={() => handleDownload(result.matrixC, 'result-matrix')}
                        className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        下载 CSV
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">结果矩阵大小:</span>
                          <span className="font-mono">{result.matrixC.rows} × {result.matrixC.cols}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">非零元素:</span>
                          <span className="font-mono">{result.matrixC.nnz.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            计算耗时:
                          </span>
                          <span className="text-green-400 font-semibold text-lg">
                            {result.duration.toFixed(2)} ms
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Cpu className="w-4 h-4" />
                            计算引擎:
                          </span>
                          <span className="font-semibold">
                            {getEngineLabel(computeEngine)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 flex items-center gap-1">
                            <BarChart3 className="w-4 h-4" />
                            内存峰值:
                          </span>
                          <span className="font-mono">
                            {formatBytes(result.memoryUsage.peak)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'result' && svdResult && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-green-400 flex items-center gap-2">
                      <Layers className="w-5 h-5" />
                      SVD 分解结果
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400">U 矩阵:</span>
                          <span className="font-mono">{svdResult.rows} × {svdRank}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">S 奇异值:</span>
                          <span className="font-mono">{svdRank} 个</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">V 矩阵:</span>
                          <span className="font-mono">{svdRank} × {svdResult.cols}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-slate-400 mb-2">奇异值 (前 5 个):</div>
                        {Array.from(svdResult.S.slice(0, 5)).map((v, i) => (
                          <div key={i} className="flex justify-between font-mono text-xs">
                            <span>σ{i + 1}:</span>
                            <span className="text-blue-400">{v.toExponential(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'result' && eigenResult && (
                  <div className="space-y-4">
                    <h3 className="font-semibold text-green-400 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" />
                      特征值计算结果
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400">矩阵大小:</span>
                          <span className="font-mono">{eigenResult.n} × {eigenResult.n}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">特征向量数:</span>
                          <span className="font-mono">{eigenCount}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-slate-400 mb-2">特征值 (前 5 个):</div>
                        {Array.from(eigenResult.values.slice(0, 5)).map((v, i) => (
                          <div key={i} className="flex justify-between font-mono text-xs">
                            <span>λ{i + 1}:</span>
                            <span className="text-purple-400">{v.toExponential(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'visualization' && result && (
                  <MatrixHeatmap
                    matrix={result.matrixC}
                    rows={result.matrixC.rows}
                    cols={result.matrixC.cols}
                    title="结果矩阵热力图"
                  />
                )}

                {activeTab === 'visualization' && svdResult && (
                  <div className="grid grid-cols-2 gap-4">
                    <MatrixHeatmap
                      matrix={new Float64Array(svdResult.U)}
                      rows={svdResult.rows}
                      cols={svdRank}
                      title="U 矩阵"
                    />
                    <MatrixHeatmap
                      matrix={new Float64Array(svdResult.V)}
                      rows={svdRank}
                      cols={svdResult.cols}
                      title="V 矩阵"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右侧历史记录 */}
          <div className="col-span-3">
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 h-full">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                计算历史
              </h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">
                    暂无计算历史
                  </p>
                ) : (
                  history.map((record) => (
                    <div
                      key={record.id}
                      className="p-3 bg-slate-900 rounded-lg border border-slate-700"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${record.engine === 'webgpu' ? 'bg-green-900 text-green-300' : record.engine === 'wasm' ? 'bg-blue-900 text-blue-300' : 'bg-yellow-900 text-yellow-300'}`}>
                          {getEngineLabel(record.engine)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(record.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-sm">
                        <div className="text-slate-400 mb-1">
                          {record.matrixA.rows}×{record.matrixA.cols} × {record.matrixB.rows}×{record.matrixB.cols}
                        </div>
                        <div className="text-green-400 font-semibold text-lg">
                          {record.duration.toFixed(2)} ms
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;