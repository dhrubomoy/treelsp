/**
 * Default validation implementations
 * These run automatically unless overridden
 */

import type { NodeValidator } from '../definition/validation.js';

/**
 * Default validator for unresolved references
 * Checks semantic layer's reference descriptors and reports diagnostics
 *
 * Note: Unresolved reference reporting is handled automatically by
 * the diagnostics handler (collectUnresolvedReferences). This validator
 * is provided for users who want to add it to custom validation pipelines.
 */
export const $references: NodeValidator = (_node, _ctx) => {
  // Automatic unresolved reference detection is done in diagnostics.ts
  // This validator exists as a hook for custom validation logic
};

/**
 * Default validator for duplicate declarations
 * Checks semantic layer's declaration descriptors and reports diagnostics
 */
export const $declarations: NodeValidator = (node, ctx) => {
  const scope = ctx.scopeOf(node);
  if (!scope) {
    return;
  }

  const declarations = ctx.declarationsOf(node);
  const seen = new Map<string, number>();

  for (const decl of declarations) {
    const name = decl.name as string;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);

    if (count > 0) {
      ctx.warning(decl.node, `Duplicate declaration '${name}'`, {
        code: 'duplicate-declaration',
      });
    }
  }
};
