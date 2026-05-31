export interface Node {
  id: string;
  label?: string;
}

export interface Edge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

export interface SearchState {
  current: string | null;
  visited: string[];
  visitedSet: Set<string>;
  queue: string[];
  isComplete: boolean;
  step: number;
  path: string[];
  targetNode: string | null;
  foundTarget: boolean;
}

export interface WorkerMessage {
  type: 'START' | 'STEP' | 'COMPLETE';
  payload: {
    current: string | null;
    newVisited: string;
    visited: string[];
    queue: string[];
    isComplete: boolean;
    step: number;
    path: string[];
    targetNode: string | null;
    foundTarget: boolean;
  };
}

export type AlgorithmType = 'BFS' | 'ASTAR';

export interface WorkerInput {
  graph: GraphData;
  startNode: string;
  targetNode: string;
  speed: number;
  algorithm: AlgorithmType;
}
