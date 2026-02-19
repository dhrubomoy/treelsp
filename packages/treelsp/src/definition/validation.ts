/**
 * Validation definition layer
 * Custom validators for AST nodes
 */

/**
 * Diagnostic options
 */
export interface DiagnosticOptions {
  /** Report on specific child node */
  at?: any;

  /** Highlight named field */
  property?: string;

  /** If property is array, which element */
  index?: number;

  /** Quick fix */
  fix?: {
    label: string;
    edits: any[];
  };

  /** Diagnostic code */
  code?: string;

  /** Documentation URL */
  url?: string;
}

/**
 * ValidationContext - provided to validators
 */
export interface ValidationContext {
  error(node: any, message: string, options?: DiagnosticOptions): void;
  warning(node: any, message: string, options?: DiagnosticOptions): void;
  info(node: any, message: string, options?: DiagnosticOptions): void;
  hint(node: any, message: string, options?: DiagnosticOptions): void;
  resolve(node: any): any;
  scopeOf(node: any): any;
  declarationsOf(node: any): any[];
  referencesTo(node: any): any[];
  document: any;
  workspace: any;
}

/**
 * Node validator function
 */
export type NodeValidator = (node: any, ctx: ValidationContext) => void;

/**
 * Document validator function
 */
export type DocumentValidator = (ctx: ValidationContext) => void;

/**
 * Workspace validator function
 */
export type WorkspaceValidator = (ctx: ValidationContext) => void;

/**
 * Validation definition - maps rule names to validators
 */
export type ValidationDefinition<T extends string = string> = {
  [K in T | '$document' | '$workspace']?: NodeValidator | NodeValidator[];
};

/**
 * Merge multiple validation definitions
 * Arrays per rule key are concatenated
 */
export function mergeValidation<T extends string = string>(
  ...definitions: ValidationDefinition<T>[]
): ValidationDefinition<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const def of definitions) {
    for (const [key, value] of Object.entries(def)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const existing = result[key];
      if (!existing) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        result[key] = value;
      } else {
        const existingArr = Array.isArray(existing) ? existing : [existing];
        const incomingArr = Array.isArray(value) ? value : [value];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        result[key] = [...existingArr, ...incomingArr];
      }
    }
  }

  return result as ValidationDefinition<T>;
}
