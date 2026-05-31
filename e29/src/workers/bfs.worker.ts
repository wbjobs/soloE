import { GraphData, WorkerMessage, WorkerInput } from '../types';

interface NodePosition {
  x: number;
  y: number;
}

interface PriorityQueueItem {
  node: string;
  priority: number;
}

class PriorityQueue {
  private items: PriorityQueueItem[] = [];

  enqueue(node: string, priority: number): void {
    const item: PriorityQueueItem = { node, priority };
    let added = false;
    for (let i = 0; i < this.items.length; i++) {
      if (item.priority < this.items[i].priority) {
        this.items.splice(i, 0, item);
        added = true;
        break;
      }
    }
    if (!added) {
      this.items.push(item);
    }
  }

  dequeue(): string | undefined {
    return this.items.shift()?.node;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  includes(node: string): boolean {
    return this.items.some(item => item.node === node);
  }

  toArray(): string[] {
    return this.items.map(item => item.node);
  }

  size(): number {
    return this.items.length;
  }
}

const buildAdjacencyList = (graph: GraphData): Map<string, string[]> => {
  const adjacency = new Map<string, string[]>();
  
  graph.nodes.forEach(node => {
    adjacency.set(node.id, []);
  });
  
  graph.edges.forEach(edge => {
    const sourceNeighbors = adjacency.get(edge.source);
    const targetNeighbors = adjacency.get(edge.target);
    
    if (sourceNeighbors) {
      sourceNeighbors.push(edge.target);
    }
    if (targetNeighbors) {
      targetNeighbors.push(edge.source);
    }
  });
  
  return adjacency;
};

const generateNodePositions = (graph: GraphData): Map<string, NodePosition> => {
  const positions = new Map<string, NodePosition>();
  const n = graph.nodes.length;
  
  graph.nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / n;
    const radius = 300 + Math.random() * 100;
    positions.set(node.id, {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  });
  
  return positions;
};

const heuristic = (
  nodeA: string,
  nodeB: string,
  positions: Map<string, NodePosition>
): number => {
  const posA = positions.get(nodeA);
  const posB = positions.get(nodeB);
  
  if (!posA || !posB) return 0;
  
  return Math.abs(posA.x - posB.x) + Math.abs(posA.y - posB.y);
};

const reconstructPath = (
  cameFrom: Map<string, string | null>,
  current: string
): string[] => {
  const path: string[] = [current];
  let node = current;
  
  while (cameFrom.has(node) && cameFrom.get(node) !== null) {
    node = cameFrom.get(node)!;
    path.unshift(node);
  }
  
  return path;
};

const yieldToEventLoop = (): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, 0));
};

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const runBFS = async (
  graph: GraphData,
  startNode: string,
  targetNode: string,
  speed: number
) => {
  const adjacency = buildAdjacencyList(graph);
  const visited: Set<string> = new Set();
  const queue: string[] = [startNode];
  const cameFrom: Map<string, string | null> = new Map();
  const visitedList: string[] = [];
  let step = 0;
  let foundTarget = false;
  let finalPath: string[] = [];
  
  cameFrom.set(startNode, null);
  
  await yieldToEventLoop();
  
  self.postMessage({
    type: 'START',
    payload: {
      current: null,
      newVisited: '',
      visited: [],
      queue: [startNode],
      isComplete: false,
      step: 0,
      path: [],
      targetNode,
      foundTarget: false,
    },
  } as WorkerMessage);
  
  while (queue.length > 0 && !foundTarget) {
    await sleep(speed);
    await yieldToEventLoop();
    
    const current = queue.shift()!;
    
    if (visited.has(current)) {
      continue;
    }
    
    visited.add(current);
    visitedList.push(current);
    step++;
    
    if (current === targetNode) {
      foundTarget = true;
      finalPath = reconstructPath(cameFrom, current);
    }
    
    self.postMessage({
      type: 'STEP',
      payload: {
        current,
        newVisited: current,
        visited: visitedList,
        queue: [...queue],
        isComplete: false,
        step,
        path: foundTarget ? finalPath : [],
        targetNode,
        foundTarget,
      },
    } as WorkerMessage);
    
    if (foundTarget) break;
    
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor) && !queue.includes(neighbor)) {
        cameFrom.set(neighbor, current);
        queue.push(neighbor);
      }
    }
    
    await yieldToEventLoop();
  }
  
  await sleep(speed);
  await yieldToEventLoop();
  
  self.postMessage({
    type: 'COMPLETE',
    payload: {
      current: null,
      newVisited: '',
      visited: visitedList,
      queue: [],
      isComplete: true,
      step,
      path: finalPath,
      targetNode,
      foundTarget,
    },
  } as WorkerMessage);
};

const runAStar = async (
  graph: GraphData,
  startNode: string,
  targetNode: string,
  speed: number
) => {
  const adjacency = buildAdjacencyList(graph);
  const positions = generateNodePositions(graph);
  const visited: Set<string> = new Set();
  const openSet = new PriorityQueue();
  const cameFrom: Map<string, string | null> = new Map();
  const gScore: Map<string, number> = new Map();
  const fScore: Map<string, number> = new Map();
  const visitedList: string[] = [];
  let step = 0;
  let foundTarget = false;
  let finalPath: string[] = [];
  
  graph.nodes.forEach(node => {
    gScore.set(node.id, Infinity);
    fScore.set(node.id, Infinity);
  });
  
  gScore.set(startNode, 0);
  fScore.set(startNode, heuristic(startNode, targetNode, positions));
  openSet.enqueue(startNode, fScore.get(startNode)!);
  cameFrom.set(startNode, null);
  
  await yieldToEventLoop();
  
  self.postMessage({
    type: 'START',
    payload: {
      current: null,
      newVisited: '',
      visited: [],
      queue: openSet.toArray(),
      isComplete: false,
      step: 0,
      path: [],
      targetNode,
      foundTarget: false,
    },
  } as WorkerMessage);
  
  while (!openSet.isEmpty() && !foundTarget) {
    await sleep(speed);
    await yieldToEventLoop();
    
    const current = openSet.dequeue()!;
    
    if (visited.has(current)) {
      continue;
    }
    
    visited.add(current);
    visitedList.push(current);
    step++;
    
    if (current === targetNode) {
      foundTarget = true;
      finalPath = reconstructPath(cameFrom, current);
    }
    
    self.postMessage({
      type: 'STEP',
      payload: {
        current,
        newVisited: current,
        visited: visitedList,
        queue: openSet.toArray(),
        isComplete: false,
        step,
        path: foundTarget ? finalPath : [],
        targetNode,
        foundTarget,
      },
    } as WorkerMessage);
    
    if (foundTarget) break;
    
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      
      const tentativeGScore = (gScore.get(current) || 0) + 1;
      
      if (tentativeGScore < (gScore.get(neighbor) || Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeGScore);
        fScore.set(neighbor, tentativeGScore + heuristic(neighbor, targetNode, positions));
        
        if (!openSet.includes(neighbor)) {
          openSet.enqueue(neighbor, fScore.get(neighbor)!);
        }
      }
    }
    
    await yieldToEventLoop();
  }
  
  await sleep(speed);
  await yieldToEventLoop();
  
  self.postMessage({
    type: 'COMPLETE',
    payload: {
      current: null,
      newVisited: '',
      visited: visitedList,
      queue: [],
      isComplete: true,
      step,
      path: finalPath,
      targetNode,
      foundTarget,
    },
  } as WorkerMessage);
};

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { graph, startNode, targetNode, speed, algorithm } = event.data;
  
  if (algorithm === 'ASTAR') {
    runAStar(graph, startNode, targetNode, speed);
  } else {
    runBFS(graph, startNode, targetNode, speed);
  }
};
