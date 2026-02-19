/**
 * Parser backend registry for the CLI.
 *
 * Maps backend identifiers to their codegen implementations.
 * New backends are registered here.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParserBackendCodegen } from 'treelsp/runtime';

// Resolve the tree-sitter binary from the tree-sitter-cli dependency
// (tree-sitter-cli is a dependency of @treelsp/cli, not of treelsp itself)
const treeSitterBin = resolve(
  dirname(fileURLToPath(import.meta.resolve('tree-sitter-cli/cli.js'))),
  'tree-sitter',
);

const BACKENDS: Record<string, () => Promise<ParserBackendCodegen>> = {
  'tree-sitter': async () => {
    const { TreeSitterCodegen } = await import('treelsp/codegen/tree-sitter') as { TreeSitterCodegen: new (options?: { treeSitterBin?: string }) => ParserBackendCodegen };
    return new TreeSitterCodegen({ treeSitterBin });
  },
};

/**
 * Resolve a codegen backend by identifier.
 * Defaults to "tree-sitter" if not specified.
 */
export async function getCodegenBackend(id: string = 'tree-sitter'): Promise<ParserBackendCodegen> {
  const factory = BACKENDS[id];
  if (!factory) {
    const available = Object.keys(BACKENDS).join(', ');
    throw new Error(`Unknown parser backend: "${id}". Available backends: ${available}`);
  }
  return factory();
}
