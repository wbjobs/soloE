import { useState, useEffect, useMemo } from 'react';
import { GraphVisualization } from './components/GraphVisualization';
import { ControlPanel } from './components/ControlPanel';
import { useSearch } from './hooks/useBFS';
import { sampleGraph } from './data/sampleGraph';
import { AlgorithmType } from './types';

function App() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [speed, setSpeed] = useState(500);
  const [algorithm, setAlgorithm] = useState<AlgorithmType>('BFS');
  const [startNode, setStartNode] = useState('A');
  const [targetNode, setTargetNode] = useState('J');
  
  const { state: searchState, isRunning, startSearch, reset } = useSearch();

  const nodeOptions = useMemo(() => {
    return sampleGraph.nodes.map(node => node.id);
  }, []);

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth - 380,
        height: window.innerHeight - 64,
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleStart = () => {
    startSearch(sampleGraph, startNode, targetNode, speed, algorithm);
  };

  const handleReset = () => {
    reset();
  };

  return (
    <div className="min-h-screen flex">
      <div className="w-80 p-4 flex-shrink-0">
        <ControlPanel
          isRunning={isRunning}
          searchState={searchState}
          speed={speed}
          algorithm={algorithm}
          startNode={startNode}
          targetNode={targetNode}
          nodeOptions={nodeOptions}
          onSpeedChange={setSpeed}
          onAlgorithmChange={setAlgorithm}
          onStartNodeChange={setStartNode}
          onTargetNodeChange={setTargetNode}
          onStart={handleStart}
          onReset={handleReset}
          totalNodes={sampleGraph.nodes.length}
        />
      </div>

      <div className="flex-1 p-4">
        <div className="w-full h-full controls-bg rounded-2xl p-4 overflow-hidden">
          <GraphVisualization
            graph={sampleGraph}
            searchState={searchState}
            width={dimensions.width}
            height={dimensions.height}
            startNode={startNode}
            targetNode={targetNode}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
