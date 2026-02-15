/**
 * LSP server manifest codegen
 */

import type { LanguageDefinition } from '../definition/index.js';

/**
 * Manifest for VS Code extension discovery
 */
export interface TreelspManifest {
  /** Language name (e.g., "MiniLang") */
  name: string;
  /** Language ID for LSP (lowercase, e.g., "minilang") */
  languageId: string;
  /** File extensions including dot (e.g., [".mini"]) */
  fileExtensions: string[];
  /** Path to compiled server entry point, relative to manifest */
  server: string;
}

/**
 * Generate treelsp.json manifest for VS Code extension discovery
 *
 * The manifest tells the VS Code extension:
 * - What language this server handles
 * - Which file extensions to activate on
 * - Where to find the compiled server entry point
 */
export function generateManifest<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const manifest: TreelspManifest = {
    name: definition.name,
    languageId: definition.name.toLowerCase(),
    fileExtensions: definition.fileExtensions,
    server: './server.bundle.cjs',
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}
