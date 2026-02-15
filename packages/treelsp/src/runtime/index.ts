/**
 * Runtime module
 * Exports for generated LSP servers — not part of the language definition API
 */

// Parser
// ASTNode exported as type-only (class has computed Symbol property incompatible with isolatedDeclarations)
export { type ASTNode, type Position, type SourceProvider } from './parser/index.js';
export {
  DocumentState,
  createDocumentState,
  type DocumentMetadata,
  type TextEdit,
} from './parser/index.js';
export { createParser, loadLanguage, preloadParser } from './parser/index.js';

// Scope
export { Scope, type Declaration, type Reference } from './scope/index.js';
export {
  buildScopes,
  type ResolutionContext,
  type DocumentScope,
} from './scope/index.js';
export { Workspace, type WorkspaceDocument } from './scope/index.js';

// LSP
export { createServer, type LanguageService } from './lsp/server.js';
export { DocumentManager } from './lsp/documents.js';
export { type Diagnostic, type DiagnosticSeverity } from './lsp/diagnostics.js';
export { type HoverResult } from './lsp/hover.js';
export { type DefinitionResult } from './lsp/definition.js';
export { type ReferenceLocation } from './lsp/references.js';
export { type RenameResult } from './lsp/rename.js';
export { type DocumentSymbol } from './lsp/symbols.js';
