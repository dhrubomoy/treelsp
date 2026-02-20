/**
 * Runtime parser module
 *
 * Exports abstract interfaces (ASTNode, DocumentState, ParserBackend)
 * and the default Tree-sitter implementation.
 */

// Abstract interfaces
export type { ASTNode, Position, SourceProvider } from './ast-node.js';
export type { DocumentState, DocumentMetadata, TextEdit, ContentChange } from './document-state.js';
export type {
  ParserBackend,
  ParserBackendCodegen,
  ParserBackendRuntime,
  BuildArtifact,
  CompileOptions,
  CleanupPatterns,
  RuntimeFile,
} from './backend.js';

// Tree-sitter implementation (default backend)
export { TreeSitterASTNode } from './tree-sitter/node.js';
export { TreeSitterDocumentState, createDocumentState } from './tree-sitter/tree.js';
export { createParser, loadLanguage, preloadParser } from './tree-sitter/wasm.js';
export { TreeSitterRuntime } from './tree-sitter/backend.js';
