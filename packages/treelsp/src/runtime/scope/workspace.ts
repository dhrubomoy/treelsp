/**
 * Workspace index
 * Cross-file index for imports and global symbols
 */

import type { DocumentState } from '../parser/document-state.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { Declaration } from './scope.js';
import { buildScopes, type DocumentScope } from './resolver.js';

/**
 * Document entry in the workspace
 */
export interface WorkspaceDocument {
  /** Document state (AST) */
  document: DocumentState;

  /** Scope information */
  scope: DocumentScope;
}

/**
 * Workspace - manages multiple documents and cross-file resolution
 *
 * V1: Basic cross-file index for public declarations
 * - Stores DocumentScope for each file
 * - Provides lookup by URI
 * - Exports public declarations for cross-file resolution
 *
 * V2: Will add module resolution, import tracking, circular dependency detection
 */
export class Workspace {
  /**
   * Semantic definition (shared across all documents)
   */
  private semantic: SemanticDefinition;

  /**
   * Documents indexed by URI
   */
  private documents = new Map<string, WorkspaceDocument>();

  /**
   * Index of public declarations by name (for cross-file lookup)
   * Maps name → array of declarations from all files
   */
  private publicDeclarations = new Map<string, Declaration[]>();

  /**
   * Fingerprint of each document's public declarations.
   * Used to skip cross-file rescoping when public declarations haven't changed.
   * Maps URI → Set of "name|declaredBy|visibility" keys.
   */
  private publicDeclFingerprints = new Map<string, Set<string>>();

  constructor(semantic: SemanticDefinition) {
    this.semantic = semantic;
  }

  /**
   * Add or update a document in the workspace
   *
   * @param document The document to add/update
   * @returns The DocumentScope for this document
   */
  addDocument(document: DocumentState): DocumentScope {
    const scope = buildScopes(document, this.semantic, this);

    this.documents.set(document.uri, {
      document,
      scope,
    });

    // Compute fingerprint of this document's public declarations
    const newFingerprint = computePublicFingerprint(scope);
    const oldFingerprint = this.publicDeclFingerprints.get(document.uri);
    this.publicDeclFingerprints.set(document.uri, newFingerprint);

    // Update public declarations index
    this.rebuildPublicIndex();

    // Re-scope other documents only if the public declaration set changed.
    // Most edits (typing inside a function body, editing expressions) don't
    // change public declarations, so this skips O(files) rescoping ~99% of the time.
    if (!setsEqual(newFingerprint, oldFingerprint)) {
      for (const [uri, entry] of this.documents) {
        if (uri === document.uri) continue;
        entry.scope = buildScopes(entry.document, this.semantic, this);
      }
    }

    return scope;
  }

  /**
   * Remove a document from the workspace
   */
  removeDocument(uri: string): void {
    this.documents.delete(uri);
    this.publicDeclFingerprints.delete(uri);
    this.rebuildPublicIndex();
  }

  /**
   * Get a document by URI
   */
  getDocument(uri: string): WorkspaceDocument | null {
    return this.documents.get(uri) ?? null;
  }

  /**
   * Get all documents in the workspace
   */
  getAllDocuments(): WorkspaceDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Look up a public declaration by name across all files
   *
   * @param name The name to look up
   * @param declaredBy Optional filter by declaration type(s)
   * @returns Array of matching declarations from all files
   */
  lookupPublic(name: string, declaredBy?: string | string[]): Declaration[] {
    const declarations = this.publicDeclarations.get(name);
    if (!declarations) {
      return [];
    }

    // Filter by declaredBy
    if (declaredBy) {
      const types = Array.isArray(declaredBy) ? declaredBy : [declaredBy];
      return declarations.filter(d => types.includes(d.declaredBy));
    }

    return declarations;
  }

  /**
   * Get all public declarations in the workspace
   */
  getAllPublicDeclarations(): Declaration[] {
    const all: Declaration[] = [];
    for (const declarations of this.publicDeclarations.values()) {
      all.push(...declarations);
    }
    return all;
  }

  /**
   * Rebuild the public declarations index
   * Called after any document is added/removed/updated
   */
  private rebuildPublicIndex(): void {
    this.publicDeclarations.clear();

    // Collect all public declarations from all documents
    for (const { scope } of this.documents.values()) {
      const publicDecls = scope.root.allDeclarations({ visibility: 'public' });

      for (const decl of publicDecls) {
        const existing = this.publicDeclarations.get(decl.name);
        if (existing) {
          existing.push(decl);
        } else {
          this.publicDeclarations.set(decl.name, [decl]);
        }
      }
    }
  }

  /**
   * Find circular imports (placeholder for v2)
   *
   * V1: Not implemented
   * V2: Will track import graph and detect cycles
   *
   * @returns Array of circular import chains
   */
  findCircularImports(): Array<{ node: any; path: string[] }> {
    // V2: Implement import graph analysis
    return [];
  }

  /**
   * Get workspace statistics (for debugging)
   */
  getStats(): {
    documentCount: number;
    publicDeclarationCount: number;
    totalDeclarationCount: number;
    totalReferenceCount: number;
  } {
    let totalDecls = 0;
    let totalRefs = 0;

    for (const { scope } of this.documents.values()) {
      totalDecls += scope.declarations.length;
      totalRefs += scope.references.length;
    }

    return {
      documentCount: this.documents.size,
      publicDeclarationCount: this.getAllPublicDeclarations().length,
      totalDeclarationCount: totalDecls,
      totalReferenceCount: totalRefs,
    };
  }

  /**
   * Clear all documents from the workspace
   */
  clear(): void {
    this.documents.clear();
    this.publicDeclarations.clear();
    this.publicDeclFingerprints.clear();
  }
}

/**
 * Compute a fingerprint of a document's public declarations.
 * Each declaration is represented as "name|declaredBy|visibility".
 */
function computePublicFingerprint(scope: DocumentScope): Set<string> {
  const keys = new Set<string>();
  const publicDecls = scope.root.allDeclarations({ visibility: 'public' });
  for (const decl of publicDecls) {
    keys.add(`${decl.name}|${decl.declaredBy}|${decl.visibility}`);
  }
  return keys;
}

/**
 * Check if two sets are equal (same size and same elements).
 */
function setsEqual(a: Set<string>, b: Set<string> | undefined): boolean {
  if (!b) return a.size === 0;
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}
