/**
 * ParserBackend interfaces
 *
 * The abstraction layer between the grammar definition and parser-specific
 * implementation. Each parser engine (Tree-sitter, Lezer, Chevrotain, etc.)
 * implements these interfaces.
 *
 * Split into two halves to keep runtime bundles lean:
 * - ParserBackendCodegen — used by CLI at codegen/build time
 * - ParserBackendRuntime — used by the LSP server at runtime
 */

import type { LanguageDefinition } from '../../definition/index.js';
import type { DocumentState, DocumentMetadata } from './document-state.js';

/**
 * A file produced by the backend during code generation.
 */
export interface BuildArtifact {
  /** Relative path within the output directory (e.g., "grammar.js") */
  path: string;
  /** File content */
  content: string;
}

/**
 * Options for the compile step.
 */
export interface CompileOptions {
  /** Progress callback for UI updates (spinner text, etc.) */
  onProgress?: (message: string) => void;
}

/**
 * Cleanup patterns for build artifacts that should be removed after compilation.
 */
export interface CleanupPatterns {
  /** Directories to remove (relative to projectDir) */
  directories?: string[];
  /** Specific files to remove (relative to projectDir) */
  files?: string[];
  /** Glob patterns for files to remove (relative to projectDir) */
  globs?: string[];
}

/**
 * A runtime file that needs to be copied alongside the server bundle.
 */
export interface RuntimeFile {
  /** Absolute path to the source file */
  src: string;
  /** Filename for the destination (placed in outDir) */
  dest: string;
}

/**
 * Codegen-time backend interface (used by CLI)
 *
 * Responsible for generating parser source files and compiling them.
 * Called during `treelsp generate` and `treelsp build`.
 */
export interface ParserBackendCodegen {
  /** Unique backend identifier (e.g., "tree-sitter", "lezer") */
  readonly id: string;

  /**
   * Generate parser source files from a language definition.
   * Returns artifacts to be written to disk.
   *
   * For tree-sitter: grammar.js, queries/highlights.scm, queries/locals.scm
   * For lezer: grammar.lezer, tokenizer.ts, etc.
   */
  generate(definition: LanguageDefinition): BuildArtifact[];

  /**
   * Compile generated parser source into a runtime-loadable format.
   *
   * For tree-sitter: runs `tree-sitter generate` + `tree-sitter build --wasm`
   * For lezer: runs `@lezer/generator` to produce a JS module
   */
  compile(
    projectDir: string,
    outDir: string,
    options?: CompileOptions,
  ): Promise<void>;

  /**
   * Build artifacts to clean up after compilation (optional).
   */
  cleanupPatterns?: CleanupPatterns;

  /**
   * Additional files needed at runtime alongside the server bundle (optional).
   * For tree-sitter: tree-sitter.wasm
   *
   * @param treelspPkgDir Absolute path to the treelsp package directory
   */
  getRuntimeFiles?(treelspPkgDir: string): RuntimeFile[];
}

/**
 * Runtime backend interface (used by LSP server)
 *
 * Responsible for creating DocumentState instances at runtime.
 * Kept separate from codegen to avoid pulling codegen code into server bundles.
 */
export interface ParserBackendRuntime {
  /** Unique backend identifier (must match the codegen counterpart) */
  readonly id: string;

  /**
   * Create a new DocumentState (parse a document).
   *
   * Called at runtime when a document is opened in the editor.
   * The parserPath points to the compiled parser produced by compile().
   */
  createDocumentState(
    parserPath: string,
    metadata: DocumentMetadata,
    text: string,
  ): Promise<DocumentState>;
}

/**
 * Full parser backend — combines codegen and runtime.
 * Not required; backends can implement the two halves separately.
 */
export type ParserBackend = ParserBackendCodegen & ParserBackendRuntime;
