/**
 * Runtime module
 * Exports for generated LSP servers — not part of the language definition API
 */

// Parser — abstract interfaces
export type { ASTNode, Position, SourceProvider } from './parser/index.js';
export type { DocumentState, DocumentMetadata, TextEdit, ContentChange } from './parser/index.js';
export type { ParserBackend, ParserBackendCodegen, ParserBackendRuntime, BuildArtifact, CompileOptions } from './parser/index.js';

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
export { type PrepareRenameResult, type RenameResult } from './lsp/rename.js';
export { type DocumentSymbol } from './lsp/symbols.js';
export {
  type SemanticTokensResult,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
} from './lsp/semantic-tokens.js';
export { type SignatureHelpResult } from './lsp/signature-help.js';
