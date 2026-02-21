/**
 * Document formatting provider
 * Delegates to user-defined $format handler
 */

import type { DocumentState } from '../parser/document-state.js';
import type { LspDefinition, FormattingEdit } from '../../definition/lsp.js';

/**
 * Formatting options from the LSP client
 */
export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/**
 * Provide document formatting edits
 *
 * Calls the `$format` handler defined in the LSP config.
 * Returns empty array if no formatter is defined.
 */
export function provideDocumentFormatting(
  document: DocumentState,
  options: FormattingOptions,
  lsp?: LspDefinition,
): FormattingEdit[] {
  const formatter = lsp?.$format;
  if (!formatter) return [];

  return formatter(document.text, document.root, options);
}
