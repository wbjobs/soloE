import React, { useState, useCallback } from 'react';
import Viewer3D from './components/Viewer3D';
import AtomInfo from './components/AtomInfo';
import Measurement from './components/Measurement';
import MoleculeStats from './components/MoleculeStats';
import OrbitalViewer from './components/OrbitalViewer';
import OrbitalControlPanel from './components/OrbitalControlPanel';
import { useMeasurement } from './hooks/useMeasurement';
import { Atom, MoleculeData } from './types';
import { generateLargeMolecule } from './utils/testMolecule';
import { parseCubeFile, CubeData } from './utils/cubeParser';
import { generateGaussianCube, generateOrbitalCube } from './utils/testCubeData';

function App() {
  const [moleculeData, setMoleculeData] = useState<MoleculeData | null>(null);
  const [selectedAtom, setSelectedAtom] = useState<Atom | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'molecule' | 'orbital'>('molecule');

  const [cubeData, setCubeData] = useState<CubeData | null>(null);
  const [positiveIso, setPositiveIso] = useState(0.5);
  const [negativeIso, setNegativeIso] = useState(-0.5);
  const [showPositive, setShowPositive] = useState(true);
  const [showNegative, setShowNegative] = useState(true);
  const [opacity, setOpacity] = useState(0.7);

  const {
    isMeasuring,
    measurement,
    handleAtomClick: handleMeasureAtomClick,
    resetMeasurement,
    toggleMeasuring
  } = useMeasurement();

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/parse-pdb', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        setMoleculeData(result.data);
        setSelectedAtom(null);
        resetMeasurement();
      } else {
        setError(result.error || '解析失败');
      }
    } catch (err) {
      setError('网络错误，请确保后端服务已启动');
    } finally {
      setIsLoading(false);
    }
  }, [resetMeasurement]);

  const handleAtomClick = useCallback((atom: Atom) => {
    if (isMeasuring) {
      handleMeasureAtomClick(atom);
    } else {
      setSelectedAtom(atom);
    }
  }, [isMeasuring, handleMeasureAtomClick]);

  const handleCubeFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const text = await file.text();
      const cube = parseCubeFile(text);
      setCubeData(cube);
      setViewMode('orbital');
      setPositiveIso(cube.maxValue * 0.3);
      setNegativeIso(cube.minValue * 0.3);
    } catch (err) {
      setError('Cube文件解析失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTestOrbital = useCallback((type: 'gaussian' | 'orbital') => {
    setIsLoading(true);
    setTimeout(() => {
      const cube = type === 'gaussian' ? generateGaussianCube() : generateOrbitalCube();
      setCubeData(cube);
      setViewMode('orbital');
      setPositiveIso(cube.maxValue * 0.5);
      setNegativeIso(cube.minValue * 0.5);
      setIsLoading(false);
    }, 100);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('molecule')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              viewMode === 'molecule'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            分子球棍模型
          </button>
          <button
            onClick={() => setViewMode('orbital')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              viewMode === 'orbital'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            分子轨道视图
          </button>
        </div>
        <div className="h-6 w-px bg-slate-600"></div>
        <button
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = viewMode === 'orbital' ? '.cube' : '.pdb';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                viewMode === 'orbital' ? handleCubeFileUpload(file) : handleFileUpload(file);
              }
            };
            input.click();
          }}
          disabled={isLoading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white rounded-lg font-medium transition-all"
        >
          {isLoading ? '加载中...' : `上传${viewMode === 'orbital' ? 'Cube' : 'PDB'}文件`}
        </button>
      </div>

      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-2 rounded-lg shadow-lg">
            {error}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {viewMode === 'molecule' ? (
            <Viewer3D
              moleculeData={moleculeData}
              onAtomClick={handleAtomClick}
              selectedAtom={selectedAtom}
              measurement={{
                firstAtom: measurement.firstAtom,
                secondAtom: measurement.secondAtom
              }}
            />
          ) : cubeData ? (
            <OrbitalViewer
              cubeData={cubeData}
              positiveIso={positiveIso}
              negativeIso={negativeIso}
              showPositive={showPositive}
              showNegative={showNegative}
              opacity={opacity}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950">
              <div className="text-center">
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-slate-800 flex items-center justify-center">
                  <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">暂无轨道数据</h2>
                <p className="text-slate-400">上传Cube文件或点击下方按钮加载测试数据</p>
              </div>
            </div>
          )}
        </div>

        <div className="w-72 bg-slate-850 p-4 overflow-y-auto border-l border-slate-700" style={{ backgroundColor: '#0f172a' }}>
          <div className="space-y-4">
            {viewMode === 'molecule' ? (
              <>
                <Measurement
                  measurement={measurement}
                  isMeasuring={isMeasuring}
                  onReset={resetMeasurement}
                />

                <AtomInfo atom={selectedAtom} />

                <MoleculeStats data={moleculeData} />

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h3 className="text-lg font-semibold text-white mb-3">测试数据</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setIsLoading(true);
                        setTimeout(() => {
                          const data = generateLargeMolecule(5000);
                          setMoleculeData(data);
                          setSelectedAtom(null);
                          resetMeasurement();
                          setIsLoading(false);
                        }, 100);
                      }}
                      disabled={isLoading}
                      className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                    >
                      加载5000原子测试分子
                    </button>
                    <button
                      onClick={() => {
                        setIsLoading(true);
                        setTimeout(() => {
                          const data = generateLargeMolecule(10000);
                          setMoleculeData(data);
                          setSelectedAtom(null);
                          resetMeasurement();
                          setIsLoading(false);
                        }, 100);
                      }}
                      disabled={isLoading}
                      className="w-full px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                    >
                      加载10000原子测试分子
                    </button>
                    <button
                      onClick={() => {
                        setMoleculeData(null);
                        setSelectedAtom(null);
                        resetMeasurement();
                      }}
                      className="w-full px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-lg transition-colors"
                    >
                      清空分子
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    提示: 滚轮缩放至远处会自动切换为点云渲染
                  </p>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h3 className="text-lg font-semibold text-white mb-3">使用说明</h3>
                  <ul className="space-y-2 text-sm text-slate-400">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      上传PDB格式文件加载分子结构
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      鼠标拖拽旋转3D视图
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      滚轮缩放，右键平移
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      点击原子查看详细信息
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      开启测量工具后点击两个原子计算距离
                    </li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <OrbitalControlPanel
                  cubeData={cubeData}
                  positiveIso={positiveIso}
                  negativeIso={negativeIso}
                  onPositiveIsoChange={setPositiveIso}
                  onNegativeIsoChange={setNegativeIso}
                  showPositive={showPositive}
                  showNegative={showNegative}
                  onShowPositiveChange={setShowPositive}
                  onShowNegativeChange={setShowNegative}
                  opacity={opacity}
                  onOpacityChange={setOpacity}
                />

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h3 className="text-lg font-semibold text-white mb-3">测试轨道</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => loadTestOrbital('gaussian')}
                      disabled={isLoading}
                      className="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                    >
                      加载高斯分布测试
                    </button>
                    <button
                      onClick={() => loadTestOrbital('orbital')}
                      disabled={isLoading}
                      className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                    >
                      加载p轨道测试
                    </button>
                    <button
                      onClick={() => {
                        setCubeData(null);
                      }}
                      className="w-full px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-lg transition-colors"
                    >
                      清空轨道
                    </button>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h3 className="text-lg font-semibold text-white mb-3">轨道说明</h3>
                  <ul className="space-y-2 text-sm text-slate-400">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      <span className="w-3 h-3 rounded-full bg-cyan-400 inline-block"></span>
                      青色: 正值等值面
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-red-400">•</span>
                      <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
                      红色: 负值等值面
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      拖动滑块实时调整等值面阈值
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      可独立开关正负等值面显示
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400">•</span>
                      调整透明度观察内部结构
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
