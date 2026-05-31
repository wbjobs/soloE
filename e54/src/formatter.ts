import * as fs from 'fs';
import * as path from 'path';
import { AnalysisResult, ModuleNode, ImpactAnalysisResult } from './types';

export function formatJSON(result: AnalysisResult, baseDir: string): string {
  const graph = result.graph;
  const nodes: Record<string, any> = {};

  for (const [filePath, node] of Object.entries(graph.nodes)) {
    const relativePath = path.relative(baseDir, filePath);
    nodes[relativePath] = {
      dependencies: node.dependencies.map(d => ({
        module: d.module,
        resolvedPath: d.resolvedPath ? path.relative(baseDir, d.resolvedPath) : undefined,
        isRelative: d.isRelative,
        isExternal: d.isExternal,
      })),
      dependents: node.dependents.map(d => path.relative(baseDir, d)),
    };
  }

  const output = {
    metadata: {
      totalModules: result.totalModules,
      totalDependencies: result.totalDependencies,
      externalDependencies: result.externalDependencies,
      analysisTime: result.analysisTime,
      entryPoints: graph.entryPoints.map(e => path.relative(baseDir, e)),
    },
    circularDependencies: result.circularDependencies.map(c => ({
      path: c.path,
      chain: c.path.join(' → '),
    })),
    modules: nodes,
  };

  return JSON.stringify(output, null, 2);
}

export function writeJSONReport(result: AnalysisResult, outputPath: string, baseDir: string): void {
  const json = formatJSON(result, baseDir);
  fs.writeFileSync(outputPath, json, 'utf-8');
}

export function formatTree(result: AnalysisResult, baseDir: string): string {
  const lines: string[] = [];
  const printed = new Set<string>();

  lines.push('');
  lines.push('📦 Dependency Tree');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  for (const entryPoint of result.graph.entryPoints) {
    const relativeEntry = path.relative(baseDir, entryPoint);
    printTree(entryPoint, '', true, printed, lines, baseDir, result.graph.nodes);
  }

  lines.push('');
  lines.push('📊 Summary');
  lines.push('═══════════════════════════════════════════════');
  lines.push(`  Total modules:      ${result.totalModules}`);
  lines.push(`  Total dependencies: ${result.totalDependencies}`);
  lines.push(`  External packages:  ${result.externalDependencies.length}`);
  lines.push(`  Analysis time:      ${result.analysisTime}ms`);
  lines.push('');

  if (result.circularDependencies.length > 0) {
    lines.push('⚠️  Circular Dependencies Found');
    lines.push('═══════════════════════════════════════════════');
    lines.push('');
    for (const [index, circular] of result.circularDependencies.entries()) {
      lines.push(`  ${index + 1}. ${circular.path.join(' → ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function printTree(
  filePath: string,
  prefix: string,
  isLast: boolean,
  printed: Set<string>,
  lines: string[],
  baseDir: string,
  nodes: Record<string, ModuleNode>
): void {
  const relativePath = path.relative(baseDir, filePath);
  const node = nodes[filePath];

  if (!node) return;

  const marker = isLast ? '└── ' : '├── ';
  const isCircular = printed.has(filePath);

  lines.push(prefix + marker + relativePath + (isCircular ? ' 🔄' : ''));

  if (isCircular) return;

  printed.add(filePath);

  const internalDeps = node.dependencies
    .filter(d => d.resolvedPath && nodes[d.resolvedPath])
    .map(d => d.resolvedPath!);

  const newPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < internalDeps.length; i++) {
    printTree(
      internalDeps[i],
      newPrefix,
      i === internalDeps.length - 1,
      printed,
      lines,
      baseDir,
      nodes
    );
  }

  printed.delete(filePath);
}

export function formatImpactAnalysis(result: ImpactAnalysisResult, baseDir: string): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('🔍 Impact Analysis');
  lines.push('═══════════════════════════════════════════════');
  lines.push(`  Target file: ${result.targetFile}`);
  lines.push('');

  if (result.totalImpacted === 0) {
    lines.push('  ✅ No files depend on this module');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('📊 Impact Summary');
  lines.push('═══════════════════════════════════════════════');
  lines.push(`  Total impacted:    ${result.totalImpacted}`);
  lines.push(`  Direct dependents: ${result.directImpacted}`);
  lines.push(`  Indirect impacted: ${result.indirectImpacted}`);
  lines.push(`  Analysis time:     ${result.analysisTime}ms`);
  lines.push('');

  lines.push('📋 Affected Modules (sorted by dependency depth)');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  for (const [index, node] of result.impactNodes.entries()) {
    const relativePath = path.relative(baseDir, node.filePath);
    const depthIndicator = '█'.repeat(Math.min(node.impactLevel + 1, 10));
    const isDirect = node.dependencyChains.some(chain => chain.length === 2);

    lines.push(`  ${String(index + 1).padStart(2)}. ${relativePath}`);
    lines.push(`      Depth: ${depthIndicator} (${node.impactLevel}) ${isDirect ? '📌 Direct' : '🔗 Indirect'}`);
    
    const shortestChain = node.dependencyChains.reduce((shortest, chain) => 
      chain.length < shortest.length ? chain : shortest, node.dependencyChains[0]
    );
    const displayChain = shortestChain.map(f => path.relative(baseDir, f));
    lines.push(`      Chain: ${displayChain.join(' → ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatImpactJSON(result: ImpactAnalysisResult, baseDir: string): string {
  const output = {
    targetFile: result.targetFile,
    summary: {
      totalImpacted: result.totalImpacted,
      directImpacted: result.directImpacted,
      indirectImpacted: result.indirectImpacted,
      analysisTime: result.analysisTime,
    },
    affectedModules: result.impactNodes.map(node => ({
      filePath: path.relative(baseDir, node.filePath),
      impactLevel: node.impactLevel,
      isDirect: node.dependencyChains.some(chain => chain.length === 2),
      dependencyChains: node.dependencyChains.map(chain => 
        chain.map(f => path.relative(baseDir, f))
      ),
    })),
  };

  return JSON.stringify(output, null, 2);
}
