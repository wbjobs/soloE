#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import { DependencyAnalyzer } from './analyzer';
import { formatTree, writeJSONReport, formatJSON, formatImpactAnalysis, formatImpactJSON } from './formatter';

const program = new Command();

program
  .name('dep-analyzer')
  .description('Analyze JavaScript/TypeScript module dependencies')
  .version('1.0.0');

program
  .command('analyze', { isDefault: true })
  .description('Analyze dependencies (default command)')
  .argument('[paths...]', 'Entry files or directories to analyze', ['./src'])
  .option('-i, --ignore <dirs...>', 'Directories to ignore (comma-separated)')
  .option('-o, --output <path>', 'Output JSON report file path')
  .option('-f, --format <type>', 'Output format: tree, json, or both', 'tree')
  .option('--no-circular', 'Skip circular dependency detection')
  .option('-e, --extensions <exts...>', 'File extensions to resolve')
  .action(async (paths, options) => {
    const baseDir = process.cwd();
    const ignoreDirs = options.ignore || ['node_modules', '.git', 'dist', 'build'];

    const analyzer = new DependencyAnalyzer({
      entryPoints: paths,
      ignoreDirs,
      ignorePatterns: [],
      resolveExtensions: options.extensions || ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      baseDir,
    });

    console.log(`🔍 Analyzing dependencies...`);
    console.log(`  Entry points: ${paths.join(', ')}`);
    console.log(`  Ignore dirs:  ${ignoreDirs.join(', ')}`);
    console.log('');

    try {
      const result = await analyzer.analyze();

      if (options.format === 'tree' || options.format === 'both') {
        console.log(formatTree(result, baseDir));
      }

      if (options.format === 'json' || options.format === 'both') {
        const jsonOutput = formatJSON(result, baseDir);
        if (options.output) {
          writeJSONReport(result, options.output, baseDir);
          console.log(`📄 JSON report written to: ${options.output}`);
        } else {
          console.log('');
          console.log('📄 JSON Report:');
          console.log('═══════════════════════════════════════════════');
          console.log(jsonOutput);
        }
      }

      if (result.circularDependencies.length > 0 && options.circular) {
        console.log(`⚠️  Found ${result.circularDependencies.length} circular dependency(ies)!`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error('❌ Error analyzing dependencies:', error);
      process.exitCode = 1;
    }
  });

program
  .command('impact')
  .description('Analyze impact scope of a file - show all files that depend on it')
  .argument('<file>', 'Target file path to analyze')
  .option('-s, --scope <dir>', 'Scope directory to scan (default: current directory)', '.')
  .option('-i, --ignore <dirs...>', 'Directories to ignore')
  .option('-o, --output <path>', 'Output JSON report file path')
  .option('-f, --format <type>', 'Output format: tree, json, or both', 'tree')
  .action(async (filePath, options) => {
    const baseDir = process.cwd();
    const ignoreDirs = options.ignore || ['node_modules', '.git', 'dist', 'build'];

    console.log(`🔍 Analyzing impact scope of: ${filePath}`);
    console.log(`  Scan scope: ${options.scope}`);
    console.log(`  Ignore dirs: ${ignoreDirs.join(', ')}`);
    console.log('');

    const analyzer = new DependencyAnalyzer({
      entryPoints: [options.scope],
      ignoreDirs,
      ignorePatterns: [],
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      baseDir,
    });

    try {
      await analyzer.analyze();
      const impactResult = analyzer.analyzeImpact(filePath);

      if (options.format === 'tree' || options.format === 'both') {
        console.log(formatImpactAnalysis(impactResult, baseDir));
      }

      if (options.format === 'json' || options.format === 'both') {
        const jsonOutput = formatImpactJSON(impactResult, baseDir);
        if (options.output) {
          const fs = await import('fs');
          fs.writeFileSync(options.output, jsonOutput, 'utf-8');
          console.log(`📄 Impact analysis written to: ${options.output}`);
        } else if (options.format === 'json') {
          console.log('');
          console.log('📄 Impact Analysis (JSON):');
          console.log('═══════════════════════════════════════════════');
          console.log(jsonOutput);
        }
      }

      if (impactResult.totalImpacted > 0) {
        console.log(`ℹ️  ${impactResult.totalImpacted} files are affected by changes to "${impactResult.targetFile}"`);
      }
    } catch (error) {
      console.error('❌ Error during impact analysis:', error);
      process.exitCode = 1;
    }
  });

program.parseAsync();
