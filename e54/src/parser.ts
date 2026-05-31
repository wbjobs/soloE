import * as fs from 'fs';
import * as path from 'path';
import { Dependency, PathAlias } from './types';

const STATIC_IMPORT_REGEX = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|[\w\s,]+|type\s+[\w\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_FROM_REGEX = /export\s+(?:\{[^}]*\}|\*\s+as\s+\w+|[\w\s,]+)\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RESOLVE_REGEX = /require\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_REGEX = /import\s*\(\s*(?:['"]([^'"]+)['"]|['"`]?([^'"`\)]+)['"`]?)\s*\)/g;
const LAZY_REQUIRE_REGEX = /(?:const|let|var)\s+\w+\s*=\s*(?:\(\)\s*=>\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const CONDITIONAL_REQUIRE_REGEX = /(?:if|else\s+if|switch)[\s\S]{0,100}?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const TERNARY_REQUIRE_REGEX = /\?[\s\S]{0,50}?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_TEMPLATE_IMPORT_REGEX = /import\s*\(\s*[`"][^`"]*?\$\{\s*[^}]+\s*\}[^`"]*?[`"]\s*\)/g;

export function parseFile(filePath: string, content?: string, pathAliases: PathAlias[] = []): Dependency[] {
  const fileContent = content || fs.readFileSync(filePath, 'utf-8');
  const dependencies: Dependency[] = [];
  const seen = new Set<string>();

  const regexPatterns = [
    STATIC_IMPORT_REGEX,
    EXPORT_FROM_REGEX,
    REQUIRE_REGEX,
    REQUIRE_RESOLVE_REGEX,
    DYNAMIC_IMPORT_REGEX,
    LAZY_REQUIRE_REGEX,
    CONDITIONAL_REQUIRE_REGEX,
    TERNARY_REQUIRE_REGEX,
  ];

  for (const regex of regexPatterns) {
    const matches = fileContent.matchAll(regex);
    for (const match of matches) {
      const moduleName = match[1] || match[2];
      if (!moduleName || seen.has(moduleName)) continue;
      
      const trimmed = moduleName.trim();
      if (!trimmed || trimmed.includes('${') || trimmed.includes('+')) continue;
      
      seen.add(trimmed);
      dependencies.push(createDependency(trimmed, pathAliases));
    }
  }

  const templateMatches = fileContent.matchAll(DYNAMIC_TEMPLATE_IMPORT_REGEX);
  for (const match of templateMatches) {
    const template = match[0];
    const staticParts = extractStaticPartsFromTemplate(template);
    for (const part of staticParts) {
      if (part && !seen.has(part)) {
        seen.add(part);
        dependencies.push(createDependency(part, pathAliases));
      }
    }
  }

  return dependencies;
}

function createDependency(moduleName: string, pathAliases: PathAlias[] = []): Dependency {
  const isRelative = moduleName.startsWith('.') || moduleName.startsWith('/');
  
  let isAlias = false;
  for (const alias of pathAliases) {
    if (moduleName.startsWith(alias.alias)) {
      isAlias = true;
      break;
    }
  }
  
  const isExternal = !isRelative && !isAlias && !moduleName.startsWith('@/');
  
  return {
    module: moduleName,
    isRelative,
    isExternal,
  };
}

function extractStaticPartsFromTemplate(template: string): string[] {
  const parts: string[] = [];
  const cleanTemplate = template.replace(/import\s*\(\s*[`"]/, '').replace(/[`"]\s*\)/, '');
  
  const segments = cleanTemplate.split(/\$\{[^}]+\}/);
  for (const segment of segments) {
    if (segment && segment.length > 2) {
      parts.push(segment);
    }
  }
  
  return parts;
}

export function loadTsConfigPaths(baseDir: string): PathAlias[] {
  const tsConfigPath = findTsConfig(baseDir);
  if (!tsConfigPath) return [];

  try {
    const tsConfigContent = fs.readFileSync(tsConfigPath, 'utf-8');
    const tsConfig = parseTsConfig(tsConfigContent);
    const baseUrl = tsConfig.compilerOptions?.baseUrl || '.';
    const paths = tsConfig.compilerOptions?.paths || {};
    
    const aliases: PathAlias[] = [];
    for (const [alias, mappings] of Object.entries(paths) as [string, string[]][]) {
      const cleanAlias = alias.replace(/\/\*$/, '');
      for (const mapping of mappings) {
        const cleanMapping = mapping.replace(/\/\*$/, '');
        aliases.push({
          alias: cleanAlias,
          path: path.resolve(path.dirname(tsConfigPath), baseUrl, cleanMapping),
        });
      }
    }
    
    return aliases;
  } catch {
    return [];
  }
}

function findTsConfig(dir: string): string | null {
  const candidates = ['tsconfig.json', 'jsconfig.json'];
  let currentDir = dir;

  while (true) {
    for (const candidate of candidates) {
      const configPath = path.join(currentDir, candidate);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

function parseTsConfig(content: string): any {
  try {
    const cleanContent = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
    return JSON.parse(cleanContent);
  } catch {
    try {
      const jsonContent = content
        .replace(/\/\/[^\r\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(jsonContent);
    } catch {
      return {};
    }
  }
}

export function resolveModulePath(
  moduleName: string,
  currentFile: string,
  extensions: string[],
  pathAliases: PathAlias[] = [],
  baseDir?: string
): string | null {
  let resolvedModule = moduleName;
  let isAlias = false;

  for (const alias of pathAliases) {
    if (moduleName.startsWith(alias.alias)) {
      const suffix = moduleName.slice(alias.alias.length);
      const cleanSuffix = suffix.startsWith('/') || suffix.startsWith('\\') ? suffix.slice(1) : suffix;
      resolvedModule = path.join(alias.path, cleanSuffix);
      isAlias = true;
      break;
    }
  }

  const currentDir = path.dirname(currentFile);
  const basePath = isAlias ? resolvedModule : path.resolve(currentDir, resolvedModule);

  if (fs.existsSync(basePath)) {
    const stats = fs.statSync(basePath);
    if (stats.isDirectory()) {
      for (const ext of extensions) {
        const indexPath = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }
      for (const ext of extensions) {
        const extPath = basePath + ext;
        if (fs.existsSync(extPath)) {
          return extPath;
        }
      }
    } else {
      return basePath;
    }
  }

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  if (baseDir) {
    const altPath = path.resolve(baseDir, moduleName);
    if (fs.existsSync(altPath)) {
      const stats = fs.statSync(altPath);
      if (stats.isFile()) return altPath;
    }
    for (const ext of extensions) {
      const fullAltPath = altPath + ext;
      if (fs.existsSync(fullAltPath)) {
        return fullAltPath;
      }
    }
  }

  return null;
}

export function shouldIgnoreFile(
  filePath: string,
  baseDir: string,
  ignoreDirs: string[],
  ignorePatterns: string[]
): boolean {
  const relativePath = path.relative(baseDir, filePath);
  const normalizedRelative = relativePath.replace(/\\/g, '/');

  for (const ignoreDir of ignoreDirs) {
    const normalizedIgnore = ignoreDir.replace(/\\/g, '/');
    if (normalizedRelative.startsWith(normalizedIgnore) || 
        normalizedRelative.includes(`/${normalizedIgnore}/`)) {
      return true;
    }
  }

  for (const pattern of ignorePatterns) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(normalizedRelative)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

export function isSourceFile(filePath: string, extensions: string[]): boolean {
  return extensions.some(ext => filePath.endsWith(ext));
}
