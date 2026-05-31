import { GraphData } from '../types';

export const sampleGraph: GraphData = {
  nodes: [
    { id: 'A', label: 'A' },
    { id: 'B', label: 'B' },
    { id: 'C', label: 'C' },
    { id: 'D', label: 'D' },
    { id: 'E', label: 'E' },
    { id: 'F', label: 'F' },
    { id: 'G', label: 'G' },
    { id: 'H', label: 'H' },
    { id: 'I', label: 'I' },
    { id: 'J', label: 'J' },
  ],
  edges: [
    { source: 'A', target: 'B' },
    { source: 'A', target: 'C' },
    { source: 'A', target: 'D' },
    { source: 'B', target: 'E' },
    { source: 'B', target: 'F' },
    { source: 'C', target: 'G' },
    { source: 'D', target: 'H' },
    { source: 'D', target: 'I' },
    { source: 'E', target: 'J' },
    { source: 'F', target: 'G' },
    { source: 'G', target: 'H' },
    { source: 'H', target: 'J' },
    { source: 'I', target: 'J' },
  ],
};
