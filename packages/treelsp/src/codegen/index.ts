/**
 * Codegen layer - internal API for generating Tree-sitter artifacts
 * Not exported from main package - used by CLI only
 */

export { generateGrammar } from './grammar.js';
export { generateAstTypes } from './ast-types.js';
export { generateServer } from './server.js';
