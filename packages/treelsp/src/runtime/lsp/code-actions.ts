/**
 * Code actions provider
 * Surfaces diagnostic fixes as quick-fix code actions
 */

import type { Position } from '../parser/node.js';
import type { TextEdit } from '../../definition/validation.js';
import type { Diagnostic } from './diagnostics.js';

/**
 * Code action result
 */
export interface CodeAction {
  title: string;
  kind: string;
  diagnostics: Diagnostic[];
  edit: { changes: Record<string, TextEdit[]> };
}

/**
 * Provide code actions for diagnostics in range
 *
 * Filters diagnostics to those overlapping the requested range
 * and extracts their fix fields into CodeAction objects.
 */
export function provideCodeActions(
  diagnostics: Diagnostic[],
  range: { start: Position; end: Position },
  uri: string,
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diag of diagnostics) {
    if (!diag.fix) continue;
    if (!rangesOverlap(diag.range, range)) continue;

    actions.push({
      title: diag.fix.label,
      kind: 'quickfix',
      diagnostics: [diag],
      edit: { changes: { [uri]: diag.fix.edits } },
    });
  }

  return actions;
}

/**
 * Check if two ranges overlap
 */
function rangesOverlap(
  a: { start: Position; end: Position },
  b: { start: Position; end: Position },
): boolean {
  return !positionAfter(a.start, b.end) && !positionAfter(b.start, a.end);
}

/**
 * Check if position a is strictly after position b
 */
function positionAfter(a: Position, b: Position): boolean {
  return a.line > b.line || (a.line === b.line && a.character > b.character);
}
