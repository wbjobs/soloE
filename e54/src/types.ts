export interface Dependency {
  module: string;
  resolvedPath?: string;
  isRelative: boolean;
  isExternal: boolean;
}

export interface ModuleNode {
  filePath: string;
  dependencies: Dependency[];
  dependents: string[];
}

export interface DependencyGraph {
  nodes: Record<string, ModuleNode>;
  entryPoints: string[];
}

export interface CircularDependency {
  path: string[];
}

export interface AnalysisResult {
  graph: DependencyGraph;
  circularDependencies: CircularDependency[];
  totalModules: number;
  totalDependencies: number;
  externalDependencies: string[];
  analysisTime: number;
}

export interface AnalyzerOptions {
  entryPoints: string[];
  ignoreDirs: string[];
  ignorePatterns: string[];
  resolveExtensions: string[];
  baseDir: string;
}

export interface PathAlias {
  alias: string;
  path: string;
}

export interface ImpactNode {
  filePath: string;
  directDependents: string[];
  indirectDependents: string[];
  allDependents: string[];
  dependencyChains: string[][];
  impactLevel: number;
}

export interface ImpactAnalysisResult {
  targetFile: string;
  impactNodes: ImpactNode[];
  totalImpacted: number;
  directImpacted: number;
  indirectImpacted: number;
  analysisTime: number;
}

export interface CLIConfig {
  entry: string[];
  ignore: string[];
  output?: string;
  format: 'json' | 'tree' | 'both';
  detectCircular: boolean;
}
