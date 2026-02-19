// Default implementations for validation and LSP features

import type { NodeValidator } from '../definition/validation.js';
import type { HoverHandler, CompletionHandler } from '../definition/lsp.js';
import type { SymbolDescriptor } from '../definition/lsp.js';
import { $references, $declarations } from './validation.js';
import { hover } from './hover.js';
import { complete } from './completion.js';
import { symbol } from './symbols.js';

export const validation: {
  $references: NodeValidator;
  $declarations: NodeValidator;
} = {
  $references: $references,
  $declarations: $declarations,
};

export const lsp: {
  hover: HoverHandler;
  complete: CompletionHandler;
  symbol: (node: any) => SymbolDescriptor | null;
} = {
  hover: hover,
  complete: complete,
  symbol: symbol,
};
