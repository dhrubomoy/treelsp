/**
 * Config file loading and resolution for treelsp CLI.
 *
 * Supports:
 * 1. treelsp-config.json (standalone config file)
 * 2. "treelsp" field in package.json
 * 3. Legacy mode: grammar.ts in cwd (backward compat)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

export interface LanguageProjectConfig {
  /** Relative path to grammar.ts from config file location */
  grammar: string;
  /** Relative path to output dir (default: dirname(grammar)/generated) */
  out?: string;
}

export interface TreelspConfig {
  languages: LanguageProjectConfig[];
}

/** A fully resolved language project with absolute paths. */
export interface ResolvedLanguageProject {
  grammarPath: string;
  projectDir: string;
  outDir: string;
}

export interface ConfigResult {
  source: 'file' | 'package.json' | 'legacy';
  configPath?: string;
  projects: ResolvedLanguageProject[];
}

/**
 * Resolve config: use -f flag, auto-discover, or fall back to legacy.
 */
export function resolveConfig(fileFlag?: string): ConfigResult {
  if (fileFlag) {
    return loadConfigFromFile(fileFlag);
  }

  const discovered = discoverConfig();
  if (discovered) {
    return discovered;
  }

  // Legacy fallback: grammar.ts in cwd
  const cwd = process.cwd();
  return {
    source: 'legacy',
    projects: [{
      grammarPath: resolve(cwd, 'grammar.ts'),
      projectDir: cwd,
      outDir: resolve(cwd, 'generated'),
    }],
  };
}

function loadConfigFromFile(filePath: string): ConfigResult {
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, 'utf-8');

  if (basename(absPath) === 'package.json') {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const treelspField = pkg['treelsp'];
    if (!treelspField) {
      throw new Error(`No "treelsp" field found in ${absPath}`);
    }
    const config = validateConfig(treelspField, absPath);
    return {
      source: 'package.json',
      configPath: absPath,
      projects: resolveProjects(config, dirname(absPath)),
    };
  }

  const config = validateConfig(JSON.parse(raw) as unknown, absPath);
  return {
    source: 'file',
    configPath: absPath,
    projects: resolveProjects(config, dirname(absPath)),
  };
}

function discoverConfig(): ConfigResult | null {
  let dir = resolve(process.cwd());

  while (true) {
    // 1. Check for treelsp-config.json
    const configFile = resolve(dir, 'treelsp-config.json');
    if (existsSync(configFile)) {
      const raw = readFileSync(configFile, 'utf-8');
      const config = validateConfig(JSON.parse(raw) as unknown, configFile);
      return {
        source: 'file',
        configPath: configFile,
        projects: resolveProjects(config, dir),
      };
    }

    // 2. Check for "treelsp" field in package.json
    const pkgFile = resolve(dir, 'package.json');
    if (existsSync(pkgFile)) {
      const raw = readFileSync(pkgFile, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      if (pkg['treelsp']) {
        const config = validateConfig(pkg['treelsp'], pkgFile);
        return {
          source: 'package.json',
          configPath: pkgFile,
          projects: resolveProjects(config, dir),
        };
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function validateConfig(raw: unknown, filePath: string): TreelspConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid config in ${filePath}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj['languages'])) {
    throw new Error(`Invalid config in ${filePath}: "languages" must be an array`);
  }

  const languages = obj['languages'] as unknown[];
  if (languages.length === 0) {
    throw new Error(`Invalid config in ${filePath}: "languages" must not be empty`);
  }

  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i];
    if (typeof lang !== 'object' || lang === null) {
      throw new Error(`Invalid config in ${filePath}: languages[${String(i)}] must be an object`);
    }
    const langObj = lang as Record<string, unknown>;
    if (typeof langObj['grammar'] !== 'string' || langObj['grammar'].length === 0) {
      throw new Error(`Invalid config in ${filePath}: languages[${String(i)}].grammar must be a non-empty string`);
    }
    if (langObj['out'] !== undefined && (typeof langObj['out'] !== 'string' || langObj['out'].length === 0)) {
      throw new Error(`Invalid config in ${filePath}: languages[${String(i)}].out must be a non-empty string if provided`);
    }
  }

  return obj as unknown as TreelspConfig;
}

function resolveProjects(config: TreelspConfig, configDir: string): ResolvedLanguageProject[] {
  return config.languages.map(lang => {
    const grammarPath = resolve(configDir, lang.grammar);
    const projectDir = dirname(grammarPath);
    const outDir = lang.out
      ? resolve(configDir, lang.out)
      : resolve(projectDir, 'generated');
    return { grammarPath, projectDir, outDir };
  });
}
