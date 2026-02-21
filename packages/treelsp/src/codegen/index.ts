/**
 * Codegen layer - internal API for generating parser artifacts
 * Not exported from main package - used by CLI only
 */

// Shared codegen (backend-agnostic)
export { generateAstTypes } from './ast-types.js';
export { generateManifest, type TreelspManifest } from './server.js';
export { generateTextmate } from './textmate.js';
