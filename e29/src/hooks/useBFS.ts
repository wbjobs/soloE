import { useState, useCallback, useRef, useEffect } from 'react';
import { GraphData, SearchState, WorkerMessage, AlgorithmType } from '../types';

const initialState: SearchState = {
  current: null,
  visited: [],
  visitedSet: new Set<string>(),
  queue: [],
  isComplete: false,
  step: 0,
  path: [],
  targetNode: null,
  foundTarget: false,
};

export const useSearch = () => {
  const [state, setState] = useState<SearchState>(initialState);
  const [isRunning, setIsRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const stateRef = useRef<SearchState>(initialState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const startSearch = useCallback((
    graph: GraphData,
    startNode: string,
    targetNode: string,
    speed: number,
    algorithm: AlgorithmType
  ) => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const newVisitedSet = new Set<string>();
    const newState = {
      ...initialState,
      visitedSet: newVisitedSet,
      targetNode,
    };
    
    setState(newState);
    stateRef.current = newState;

    workerRef.current = new Worker(
      new URL('../workers/bfs.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { payload } = event.data;
      const currentState = stateRef.current;
      
      if (payload.newVisited && !currentState.visitedSet.has(payload.newVisited)) {
        const newVisitedSet = new Set(currentState.visitedSet);
        newVisitedSet.add(payload.newVisited);
        
        const updatedState = {
          current: payload.current,
          visited: payload.visited,
          visitedSet: newVisitedSet,
          queue: payload.queue,
          isComplete: payload.isComplete,
          step: payload.step,
          path: payload.path,
          targetNode: payload.targetNode,
          foundTarget: payload.foundTarget,
        };
        
        setState(updatedState);
        stateRef.current = updatedState;
      } else if (event.data.type === 'START' || event.data.type === 'COMPLETE') {
        const newVisitedSet = new Set(payload.visited);
        const updatedState = {
          ...payload,
          visitedSet: newVisitedSet,
        };
        setState(updatedState);
        stateRef.current = updatedState;
      }
      
      if (event.data.type === 'COMPLETE') {
        setIsRunning(false);
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
      }
    };

    workerRef.current.postMessage({ 
      graph, 
      startNode, 
      targetNode, 
      speed, 
      algorithm 
    });
    setIsRunning(true);
  }, []);

  const reset = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const resetState = {
      ...initialState,
      visitedSet: new Set<string>(),
    };
    setState(resetState);
    stateRef.current = resetState;
    setIsRunning(false);
  }, []);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  return {
    state,
    isRunning,
    startSearch,
    reset,
  };
};
