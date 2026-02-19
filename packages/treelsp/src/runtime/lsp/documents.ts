/**
 * Document manager
 * Manages open documents, maintains workspace scope, and triggers reparse
 */

import type { DocumentState } from '../parser/document-state.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { DocumentScope } from '../scope/resolver.js';
import { Workspace, type WorkspaceDocument } from '../scope/workspace.js';

/**
 * Document manager for LSP
 *
 * Manages the lifecycle of open documents:
 * - Tracks open/change/close events
 * - Rebuilds scopes on document changes
 * - Maintains workspace index
 */
export class DocumentManager {
  private readonly workspace: Workspace;

  constructor(semantic: SemanticDefinition) {
    this.workspace = new Workspace(semantic);
  }

  /**
   * Open or update a document
   *
   * @param document The document state (already parsed)
   * @returns The computed scope for this document
   */
  open(document: DocumentState): DocumentScope {
    return this.workspace.addDocument(document);
  }

  /**
   * Handle a document change
   * The caller should have already called document.update() with new text
   *
   * @param document The updated document state
   * @returns The recomputed scope
   */
  change(document: DocumentState): DocumentScope {
    return this.workspace.addDocument(document);
  }

  /**
   * Close a document
   */
  close(uri: string): void {
    this.workspace.removeDocument(uri);
  }

  /**
   * Get document by URI
   */
  get(uri: string): WorkspaceDocument | null {
    return this.workspace.getDocument(uri);
  }

  /**
   * Get the workspace instance
   */
  getWorkspace(): Workspace {
    return this.workspace;
  }

  /**
   * Get all open documents
   */
  getAllDocuments(): WorkspaceDocument[] {
    return this.workspace.getAllDocuments();
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.workspace.clear();
  }
}
