/**
 * Codegen layer - internal API for generating parser artifacts
 * Not exported from main package - used by CLI only
 */

// Shared codegen (backend-agnostic)
export { generateAstTypes } from './ast-types.js';
export { generateManifest, type TreelspManifest } from './server.js';

// Tree-sitter codegen (re-exported for backward compat)
export { generateGrammar } from './tree-sitter/grammar.js';
export { generateHighlights } from './tree-sitter/highlights.js';
export { generateLocals } from './tree-sitter/locals.js';
