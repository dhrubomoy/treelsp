/**
 * Default validation implementations
 * These run automatically unless overridden
 */

import type { ValidationContext, NodeValidator } from '../definition/validation.js';

/**
 * Default validator for unresolved references
 * Checks semantic layer's reference descriptors and reports diagnostics
 */
export const $references: NodeValidator = (node, ctx) => {
  // TODO: Implement in runtime
};

/**
 * Default validator for duplicate declarations
 * Checks semantic layer's declaration descriptors and reports diagnostics
 */
export const $declarations: NodeValidator = (node, ctx) => {
  // TODO: Implement in runtime
};
