/**
 * WASM loader
 * Handles Tree-sitter WASM loading for Node.js and browser
 */

import Parser from 'web-tree-sitter';

/**
 * Platform type
 */
type Platform = 'node' | 'browser';

/**
 * Parser singleton state
 */
interface ParserState {
  initialized: boolean;
  initPromise: Promise<void> | null;
}

/**
 * Language cache to avoid re-loading WASM
 */
interface LanguageCache {
  [wasmPath: string]: Parser.Language;
}

/**
 * Global state - Parser.init() must be called exactly once
 */
const state: ParserState = {
  initialized: false,
  initPromise: null,
};

/**
 * Language cache - reuse loaded languages
 */
const languageCache: LanguageCache = {};

/**
 * Detect runtime platform
 */
function detectPlatform(): Platform {
  // Use globalThis to check for browser globals without requiring DOM types
  const global = globalThis as Record<string, unknown>;

  // Check for browser globals
  if (typeof global.window !== 'undefined' && typeof global.document !== 'undefined') {
    return 'browser';
  }

  // Check for Node.js globals
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }

  // Default to Node.js for other environments (Deno, Bun, etc.)
  return 'node';
}

/**
 * Ensure Parser is initialized
 * Safe to call multiple times - initialization happens only once
 */
async function ensureInitialized(): Promise<void> {
  if (state.initialized) {
    return;
  }

  if (state.initPromise) {
    // Already initializing - wait for it
    await state.initPromise;
    return;
  }

  // Start initialization
  state.initPromise = (async () => {
    const platform = detectPlatform();

    if (platform === 'browser') {
      // Browser: tree-sitter.wasm must be served from public directory
      // web-tree-sitter will load it from the default path
      await Parser.init();
    } else {
      // Node.js: WASM is bundled with web-tree-sitter in node_modules
      await Parser.init();
    }

    state.initialized = true;
  })();

  await state.initPromise;
}

/**
 * Load a Tree-sitter language from WASM file
 * Languages are cached to avoid redundant loading
 *
 * @param wasmPath Path to grammar.wasm file
 * @returns Tree-sitter Language instance
 */
export async function loadLanguage(wasmPath: string): Promise<Parser.Language> {
  // Ensure Parser is initialized first
  await ensureInitialized();

  // Check cache
  const cached = languageCache[wasmPath];
  if (cached) {
    return cached;
  }

  // Load language WASM
  try {
    const language = await Parser.Language.load(wasmPath);

    // Cache it
    languageCache[wasmPath] = language;

    return language;
  } catch (error) {
    throw new Error(
      `Failed to load Tree-sitter grammar from ${wasmPath}. ` +
      `Ensure the WASM file exists and is accessible. ` +
      `Run 'treelsp build' to generate the grammar. ` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a new Tree-sitter parser with the specified language
 * This is the main entry point for creating parsers
 *
 * @param wasmPath Path to grammar.wasm file
 * @returns Configured Parser instance ready to use
 *
 * @example
 * ```typescript
 * const parser = await createParser('./generated/grammar.wasm');
 * const tree = parser.parse('let x = 42;');
 * ```
 */
export async function createParser(wasmPath: string): Promise<Parser> {
  const language = await loadLanguage(wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/**
 * Preload Parser initialization (optional)
 * Useful for reducing latency of the first parse
 */
export async function preloadParser(): Promise<void> {
  await ensureInitialized();
}
