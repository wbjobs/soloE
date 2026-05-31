import { useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { GraphData, SearchState } from '../types';

interface GraphVisualizationProps {
  graph: GraphData;
  searchState: SearchState;
  width: number;
  height: number;
  startNode: string;
  targetNode: string;
}

type D3Node = d3.SimulationNodeDatum & { id: string; label?: string };
type D3Link = d3.SimulationLinkDatum<D3Node> & { source: string | D3Node; target: string | D3Node };

export const GraphVisualization = ({ 
  graph, 
  searchState, 
  width, 
  height,
  startNode,
  targetNode,
}: GraphVisualizationProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<any, D3Node, any, any> | null>(null);
  const edgeSelectionRef = useRef<d3.Selection<any, D3Link, any, any> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);

  const pathSet = useMemo(() => {
    const set = new Set<string>();
    searchState.path.forEach(node => set.add(node));
    return set;
  }, [searchState.path]);

  const pathEdgeSet = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < searchState.path.length - 1; i++) {
      const key1 = `${searchState.path[i]}-${searchState.path[i + 1]}`;
      const key2 = `${searchState.path[i + 1]}-${searchState.path[i]}`;
      set.add(key1);
      set.add(key2);
    }
    return set;
  }, [searchState.path]);

  const scheduleUpdate = useCallback(() => {
    if (pendingUpdateRef.current) return;
    
    pendingUpdateRef.current = true;
    
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    rafIdRef.current = requestAnimationFrame(() => {
      pendingUpdateRef.current = false;
      
      const nodeSelection = nodeSelectionRef.current;
      const edgeSelection = edgeSelectionRef.current;
      
      if (!nodeSelection || !edgeSelection) return;

      const { current, visitedSet } = searchState;

      nodeSelection.each(function(d: D3Node) {
        const node = d3.select(this);
        const isCurrent = d.id === current;
        const isVisited = visitedSet.has(d.id);
        const isPath = pathSet.has(d.id);
        const isStart = d.id === startNode;
        const isTarget = d.id === targetNode;
        
        node
          .classed('node-unvisited', !isVisited && !isCurrent)
          .classed('node-visited', isVisited && !isCurrent && !isPath)
          .classed('node-path', isPath && !isCurrent)
          .classed('node-current', isCurrent)
          .classed('node-start', isStart && !isCurrent)
          .classed('node-target', isTarget && !isCurrent);
      });

      edgeSelection.classed('edge-active', (d: D3Link) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : String(d.source);
        const targetId = typeof d.target === 'object' ? d.target.id : String(d.target);
        return visitedSet.has(sourceId) && visitedSet.has(targetId);
      });

      edgeSelection.classed('edge-path', (d: D3Link) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : String(d.source);
        const targetId = typeof d.target === 'object' ? d.target.id : String(d.target);
        const key = `${sourceId}-${targetId}`;
        return pathEdgeSet.has(key);
      });
    });
  }, [searchState, pathSet, pathEdgeSet, startNode, targetNode]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const nodes: D3Node[] = graph.nodes.map(node => ({ ...node }));
    const links: D3Link[] = graph.edges.map(edge => ({ ...edge }));

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 28)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#475569');

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'edge')
      .attr('stroke', '#475569')
      .attr('stroke-width', 2);

    edgeSelectionRef.current = link;

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node node-unvisited')
      .call(d3.drag<any, D3Node>()
        .on('start', (event, d) => {
          if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulationRef.current?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    node.append('circle')
      .attr('r', 20);

    node.append('text')
      .text(d => d.label || d.id)
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', 'white')
      .attr('font-weight', 'bold')
      .attr('font-size', '12px')
      .attr('text-shadow', '0 1px 2px rgba(0, 0, 0, 0.5)');

    nodeSelectionRef.current = node;

    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    if (nodes.length > 500) {
      simulation.alphaDecay(0.02).velocityDecay(0.4);
    }

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as D3Node).x!)
        .attr('y1', d => (d.source as D3Node).y!)
        .attr('x2', d => (d.target as D3Node).x!)
        .attr('y2', d => (d.target as D3Node).y!);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [graph, width, height]);

  useEffect(() => {
    scheduleUpdate();
  }, [scheduleUpdate]);

  return (
    <div className="relative w-full h-full">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="rounded-lg"
      />
      <div className="absolute top-4 right-4 flex gap-4">
        <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg">
          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
          <span className="text-slate-300 text-xs">起点</span>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-slate-300 text-xs">终点</span>
        </div>
      </div>
    </div>
  );
};
