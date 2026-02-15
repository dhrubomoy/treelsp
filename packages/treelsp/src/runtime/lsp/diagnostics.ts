/**
 * Diagnostics provider
 * Collects parse errors, unresolved references, and custom validation results
 */

import type { ASTNode } from '../parser/node.js';
import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { SemanticDefinition, UnresolvedPolicy } from '../../definition/semantic.js';
import type { ValidationDefinition, ValidationContext, DiagnosticOptions } from '../../definition/validation.js';
import type { LspDefinition, LspContext } from '../../definition/lsp.js';
import { createLspContext } from './context.js';

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Internal diagnostic representation
 * Handlers return these; server.ts converts to LSP Diagnostic protocol objects
 */
export interface Diagnostic {
  range: { start: Position; end: Position };
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source?: string;
}

/**
 * Compute all diagnostics for a document
 */
export function computeDiagnostics(
  document: DocumentState,
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  lsp?: LspDefinition,
  validation?: ValidationDefinition,
  workspace?: Workspace
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // 1. Parse errors
  collectParseErrors(document.root, diagnostics);

  // 2. Unresolved references
  collectUnresolvedReferences(docScope, semantic, lsp, diagnostics);

  // 3. Custom validation
  if (validation) {
    collectValidationDiagnostics(
      document, docScope, semantic, validation, workspace, diagnostics
    );
  }

  return diagnostics;
}

/**
 * Walk AST to find ERROR and MISSING nodes
 */
function collectParseErrors(node: ASTNode, diagnostics: Diagnostic[]): void {
  if (node.isMissing) {
    diagnostics.push({
      range: { start: node.startPosition, end: node.endPosition },
      severity: 'error',
      message: `Missing ${node.type}`,
      code: 'missing-node',
      source: 'treelsp',
    });
    return; // Don't recurse into missing nodes
  }

  if (node.isError) {
    // Only report on leaf error nodes to avoid duplicate diagnostics
    const hasErrorChild = node.children.some(c => c.isError || c.isMissing);
    if (!hasErrorChild) {
      diagnostics.push({
        range: { start: node.startPosition, end: node.endPosition },
        severity: 'error',
        message: 'Syntax error',
        code: 'syntax-error',
        source: 'treelsp',
      });
    }
  }

  for (const child of node.children) {
    collectParseErrors(child, diagnostics);
  }
}

/**
 * Report unresolved references based on semantic onUnresolved policy
 */
function collectUnresolvedReferences(
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  lsp: LspDefinition | undefined,
  diagnostics: Diagnostic[]
): void {
  for (const ref of docScope.references) {
    if (ref.resolved) {
      continue; // Resolved — no diagnostic
    }

    // Find the semantic rule for the node that owns this reference
    // Walk up to find the parent that has the references descriptor
    const refNode = ref.node;
    let parentNode: ASTNode | null = refNode.parent;
    let policy: UnresolvedPolicy = 'error';
    let optional = false;

    while (parentNode) {
      const rule = semantic[parentNode.type];
      if (rule?.references) {
        policy = rule.references.onUnresolved ?? 'error';
        optional = rule.references.optional ?? false;
        break;
      }
      parentNode = parentNode.parent;
    }

    if (optional || policy === 'ignore') {
      continue;
    }

    const severity: DiagnosticSeverity = policy === 'warning' ? 'warning' : 'error';

    // Check for custom unresolved message
    let message = `Cannot find name '${ref.name}'`;
    if (lsp?.$unresolved) {
      const ctx = {
        resolve: () => null,
        typeOf: () => null,
        scopeOf: () => docScope.root,
        document: null,
        workspace: null,
      } as unknown as LspContext;
      const custom = lsp.$unresolved(refNode, ctx);
      if (custom) {
        message = custom;
      }
    }

    diagnostics.push({
      range: { start: refNode.startPosition, end: refNode.endPosition },
      severity,
      message,
      code: 'unresolved-reference',
      source: 'treelsp',
    });
  }
}

/**
 * Run custom validators and collect their diagnostics
 */
function collectValidationDiagnostics(
  document: DocumentState,
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  validation: ValidationDefinition,
  workspace: Workspace | undefined,
  diagnostics: Diagnostic[]
): void {
  const lspContext = createLspContext(
    docScope,
    workspace ?? ({} as Workspace),
    document,
    semantic
  );

  // Build ValidationContext that collects diagnostics
  function createValidationContext(node: ASTNode): ValidationContext {
    return {
      error(target: ASTNode, message: string, options?: DiagnosticOptions) {
        addValidationDiagnostic('error', target, message, options, diagnostics);
      },
      warning(target: ASTNode, message: string, options?: DiagnosticOptions) {
        addValidationDiagnostic('warning', target, message, options, diagnostics);
      },
      info(target: ASTNode, message: string, options?: DiagnosticOptions) {
        addValidationDiagnostic('info', target, message, options, diagnostics);
      },
      hint(target: ASTNode, message: string, options?: DiagnosticOptions) {
        addValidationDiagnostic('hint', target, message, options, diagnostics);
      },
      resolve: (n: ASTNode) => lspContext.resolve(n),
      scopeOf: (n: ASTNode) => lspContext.scopeOf(n),
      declarationsOf(_target: ASTNode): any[] {
        // Find declarations for a scope node
        const scope = lspContext.scopeOf(node);
        return scope.allDeclarations();
      },
      referencesTo(_target: ASTNode): any[] {
        return docScope.references.filter(r => r.resolved?.node === _target);
      },
      document,
      workspace: workspace ?? null,
    };
  }

  // Walk AST and run validators for each node type
  walkForValidation(document.root, validation, createValidationContext);
}

/**
 * Walk AST and run matching validators
 */
function walkForValidation(
  node: ASTNode,
  validation: ValidationDefinition,
  createCtx: (node: ASTNode) => ValidationContext
): void {
  const validators = validation[node.type];
  if (validators) {
    const ctx = createCtx(node);
    const fns = Array.isArray(validators) ? validators : [validators];
    for (const fn of fns) {
      fn(node, ctx);
    }
  }

  for (const child of node.namedChildren) {
    walkForValidation(child, validation, createCtx);
  }
}

/**
 * Add a validation diagnostic to the collection
 */
function addValidationDiagnostic(
  severity: DiagnosticSeverity,
  node: ASTNode,
  message: string,
  options: DiagnosticOptions | undefined,
  diagnostics: Diagnostic[]
): void {
  const target = options?.at ?? node;
  const diag: Diagnostic = {
    range: { start: target.startPosition, end: target.endPosition },
    severity,
    message,
    source: 'treelsp',
  };
  if (options?.code) {
    diag.code = options.code;
  }
  diagnostics.push(diag);
}
