import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyGraph,
  ModuleNode,
  AnalysisResult,
  AnalyzerOptions,
  CircularDependency,
  PathAlias,
  ImpactAnalysisResult,
  ImpactNode,
} from './types';
import {
  parseFile,
  resolveModulePath,
  shouldIgnoreFile,
  isSourceFile,
  loadTsConfigPaths,
} from './parser';

export class DependencyAnalyzer {
  private options: AnalyzerOptions;
  private graph: DependencyGraph;
  private visited: Set<string>;
  private circularDeps: CircularDependency[];
  private externalDeps: Set<string>;
  private pathAliases: PathAlias[];

  constructor(options: Partial<AnalyzerOptions>) {
    this.options = {
      entryPoints: options.entryPoints || [],
      ignoreDirs: options.ignoreDirs || ['node_modules', '.git', 'dist', 'build'],
      ignorePatterns: options.ignorePatterns || [],
      resolveExtensions: options.resolveExtensions || ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      baseDir: options.baseDir || process.cwd(),
    };
    this.graph = { nodes: {}, entryPoints: [] };
    this.visited = new Set();
    this.circularDeps = [];
    this.externalDeps = new Set();
    this.pathAliases = loadTsConfigPaths(this.options.baseDir);
  }

  async analyze(): Promise<AnalysisResult> {
    const startTime = Date.now();

    const entryPaths = this.resolveEntryPoints();
    this.graph.entryPoints = entryPaths;

    for (const entryPath of entryPaths) {
      this.processFile(entryPath, []);
    }

    const totalDeps = Object.values(this.graph.nodes).reduce(
      (sum, node) => sum + node.dependencies.length,
      0
    );

    return {
      graph: this.graph,
      circularDependencies: this.circularDeps,
      totalModules: Object.keys(this.graph.nodes).length,
      totalDependencies: totalDeps,
      externalDependencies: Array.from(this.externalDeps),
      analysisTime: Date.now() - startTime,
    };
  }

  private resolveEntryPoints(): string[] {
    const resolved: string[] = [];

    for (const entry of this.options.entryPoints) {
      const fullPath = path.resolve(this.options.baseDir, entry);

      if (!fs.existsSync(fullPath)) {
        console.warn(`Entry point not found: ${fullPath}`);
        continue;
      }

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        const files = this.findAllSourceFiles(fullPath);
        resolved.push(...files);
      } else if (isSourceFile(fullPath, this.options.resolveExtensions)) {
        resolved.push(fullPath);
      }
    }

    return [...new Set(resolved)];
  }

  private findAllSourceFiles(dir: string): string[] {
    const files: string[] = [];

    const traverse = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (shouldIgnoreFile(
          fullPath,
          this.options.baseDir,
          this.options.ignoreDirs,
          this.options.ignorePatterns
        )) {
          continue;
        }

        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile() && isSourceFile(fullPath, this.options.resolveExtensions)) {
          files.push(fullPath);
        }
      }
    };

    traverse(dir);
    return files;
  }

  private processFile(filePath: string, pathStack: string[]) {
    const normalizedPath = path.normalize(filePath);

    if (shouldIgnoreFile(
      normalizedPath,
      this.options.baseDir,
      this.options.ignoreDirs,
      this.options.ignorePatterns
    )) {
      return;
    }

    if (this.visited.has(normalizedPath)) {
      const cycleIndex = pathStack.indexOf(normalizedPath);
      if (cycleIndex !== -1) {
        const cycle = [...pathStack.slice(cycleIndex), normalizedPath];
        const relativeCycle = cycle.map(p => path.relative(this.options.baseDir, p));
        this.circularDeps.push({ path: relativeCycle });
      }
      return;
    }

    this.visited.add(normalizedPath);
    pathStack.push(normalizedPath);

    const dependencies = parseFile(normalizedPath, undefined, this.pathAliases);
    const resolvedDeps = [];

    for (const dep of dependencies) {
      if (dep.isExternal) {
        this.externalDeps.add(dep.module);
        resolvedDeps.push(dep);
        continue;
      }

      const resolvedPath = resolveModulePath(
        dep.module,
        normalizedPath,
        this.options.resolveExtensions,
        this.pathAliases,
        this.options.baseDir
      );

      if (resolvedPath) {
        resolvedDeps.push({ ...dep, resolvedPath });
        this.processFile(resolvedPath, [...pathStack]);
      } else {
        resolvedDeps.push(dep);
      }
    }

    this.graph.nodes[normalizedPath] = {
      filePath: normalizedPath,
      dependencies: resolvedDeps,
      dependents: [],
    };

    for (const dep of resolvedDeps) {
      if (dep.resolvedPath && this.graph.nodes[dep.resolvedPath]) {
        this.graph.nodes[dep.resolvedPath].dependents.push(normalizedPath);
      }
    }

    pathStack.pop();
  }

  analyzeImpact(targetFilePath: string): ImpactAnalysisResult {
    const startTime = Date.now();
    const normalizedTarget = path.normalize(path.resolve(this.options.baseDir, targetFilePath));

    if (!this.graph.nodes[normalizedTarget]) {
      return {
        targetFile: targetFilePath,
        impactNodes: [],
        totalImpacted: 0,
        directImpacted: 0,
        indirectImpacted: 0,
        analysisTime: Date.now() - startTime,
      };
    }

    const visited = new Set<string>();
    const dependencyChains: string[][] = [];
    const allDependents = new Set<string>();
    const directDependents = new Set<string>();

    for (const dep of this.graph.nodes[normalizedTarget].dependents) {
      directDependents.add(dep);
      this.traceDependencyChain(dep, [normalizedTarget], visited, dependencyChains, allDependents);
    }

    const indirectDependents = new Set(
      [...allDependents].filter(d => !directDependents.has(d))
    );

    const impactNodes: ImpactNode[] = [...allDependents].map(filePath => ({
      filePath,
      directDependents: this.graph.nodes[filePath]?.dependents || [],
      indirectDependents: [],
      allDependents: [],
      dependencyChains: dependencyChains.filter(chain => chain.includes(filePath)),
      impactLevel: this.calculateImpactLevel(filePath, normalizedTarget),
    }));

    impactNodes.sort((a, b) => b.impactLevel - a.impactLevel);

    return {
      targetFile: path.relative(this.options.baseDir, normalizedTarget),
      impactNodes,
      totalImpacted: allDependents.size,
      directImpacted: directDependents.size,
      indirectImpacted: indirectDependents.size,
      analysisTime: Date.now() - startTime,
    };
  }

  private traceDependencyChain(
    currentFile: string,
    currentChain: string[],
    visited: Set<string>,
    dependencyChains: string[][],
    allDependents: Set<string>
  ): void {
    const newChain = [...currentChain, currentFile];
    dependencyChains.push(newChain);
    allDependents.add(currentFile);

    if (visited.has(currentFile)) {
      return;
    }
    visited.add(currentFile);

    const node = this.graph.nodes[currentFile];
    if (node) {
      for (const dependent of node.dependents) {
        this.traceDependencyChain(dependent, newChain, visited, dependencyChains, allDependents);
      }
    }
  }

  private calculateImpactLevel(filePath: string, targetFile: string): number {
    const node = this.graph.nodes[filePath];
    if (!node) return 0;

    let level = 0;
    const queue = [{ file: filePath, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);

      if (file === targetFile) {
        level = Math.max(level, depth);
      }

      const currentNode = this.graph.nodes[file];
      if (currentNode) {
        for (const dep of currentNode.dependencies) {
          if (dep.resolvedPath) {
            queue.push({ file: dep.resolvedPath, depth: depth + 1 });
          }
        }
      }
    }

    return level;
  }
}
