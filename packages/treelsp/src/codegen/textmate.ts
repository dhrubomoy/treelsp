/**
 * TextMate grammar codegen
 * Generates a .tmLanguage.json file from a language definition
 *
 * This is backend-agnostic — it works with any parser backend and produces
 * a standard VS Code TextMate grammar for syntactic highlighting (keywords,
 * strings, numbers, comments, operators).
 */

import type { LanguageDefinition } from '../definition/index.js';
import {
  type RuleNode,
  buildRuleNodes,
  classifyStrings,
  isTokenRule,
  classifyTokenRule,
} from './classify.js';

/**
 * TextMate grammar JSON structure
 */
interface TextMateGrammar {
  name: string;
  scopeName: string;
  patterns: TextMatePattern[];
  repository: Record<string, TextMateRule>;
}

interface TextMatePattern {
  include?: string;
  match?: string;
  name?: string;
  begin?: string;
  end?: string;
  beginCaptures?: Record<string, { name: string }>;
  endCaptures?: Record<string, { name: string }>;
  contentName?: string;
}

interface TextMateRule {
  match?: string;
  name?: string;
  begin?: string;
  end?: string;
  beginCaptures?: Record<string, { name: string }>;
  endCaptures?: Record<string, { name: string }>;
  contentName?: string;
  patterns?: TextMatePattern[];
}

/**
 * Convert a JavaScript RegExp source to a TextMate-compatible regex string.
 * TextMate uses Oniguruma regex syntax which is mostly compatible with JS.
 */
function regexToTextMate(regex: RegExp): string {
  return regex.source;
}

/**
 * Escape a string for use in a regex character class or alternation
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Classify a token rule's regex pattern to determine the TextMate scope
 */
function tokenRuleToTextMateScope(
  ruleName: string,
  languageId: string,
): string | null {
  const classification = classifyTokenRule(ruleName);
  if (!classification) return null;

  switch (classification) {
    case 'comment':
      return `comment.line.${languageId}`;
    case 'string':
      return `string.quoted.double.${languageId}`;
    case 'number':
      return `constant.numeric.${languageId}`;
    case 'boolean':
      return `constant.language.boolean.${languageId}`;
    default:
      return null;
  }
}

/**
 * Try to detect if a comment token uses a specific line-comment prefix.
 * Returns the prefix string (e.g., "//" or "#") or null.
 */
function detectCommentPrefix(node: RuleNode): string | null {
  if (node.type === 'token') {
    const pattern = node.pattern;
    if (typeof pattern === 'string') return null;

    const source = pattern.source;
    // Patterns like \/\/.* or #.*
    const match = /^((?:\\.|[^.[({*+?^$|])+)\.\*$/.exec(source);
    if (match) {
      // Unescape the prefix
      return match[1]!.replace(/\\(.)/g, '$1');
    }
  }
  return null;
}

/**
 * Generate a TextMate grammar from a language definition
 */
export function generateTextmate<T extends string>(
  definition: LanguageDefinition<T>,
): string {
  const languageId = definition.name.toLowerCase();
  const { rules } = buildRuleNodes(definition.grammar as Record<string, any>);

  const lsp = definition.lsp;

  // Classify string literals into categories
  const { keywords, operators } = classifyStrings(rules, lsp?.$keywords);

  // Build repository entries
  const repository: Record<string, TextMateRule> = {};
  const patternIncludes: string[] = [];

  // 1. Token rules (comment, string, number) — from grammar token definitions
  for (const [ruleName, ruleNode] of Object.entries(rules)) {
    if (!isTokenRule(ruleNode)) continue;

    const scope = tokenRuleToTextMateScope(ruleName, languageId);
    if (!scope) continue;

    const classification = classifyTokenRule(ruleName);
    const repoKey = classification ?? ruleName;

    if (classification === 'comment') {
      // Try to detect comment prefix for better scope name
      const prefix = detectCommentPrefix(ruleNode);
      const scopeSuffix = prefix === '#' ? 'number-sign' : prefix === '//' ? 'double-slash' : languageId;
      repository[repoKey] = {
        match: regexToTextMate((ruleNode as { type: 'token'; pattern: string | RegExp }).pattern as RegExp),
        name: `comment.line.${scopeSuffix}.${languageId}`,
      };
    } else if (classification === 'string') {
      // Use begin/end for string rules to support multiline in the future
      const pattern = (ruleNode as { type: 'token'; pattern: string | RegExp }).pattern;
      if (pattern instanceof RegExp) {
        repository[repoKey] = {
          match: regexToTextMate(pattern),
          name: scope,
        };
      }
    } else {
      const pattern = (ruleNode as { type: 'token'; pattern: string | RegExp }).pattern;
      if (pattern instanceof RegExp) {
        repository[repoKey] = {
          match: regexToTextMate(pattern),
          name: scope,
        };
      }
    }

    patternIncludes.push(repoKey);
  }

  // 2. Keywords
  if (keywords.length > 0) {
    const keywordPattern = keywords.map(k => escapeRegex(k)).join('|');
    repository['keyword'] = {
      match: `\\b(${keywordPattern})\\b`,
      name: `keyword.control.${languageId}`,
    };
    patternIncludes.push('keyword');
  }

  // 3. Operators
  if (operators.length > 0) {
    // Sort by length descending so longer operators match first
    const sortedOps = [...operators].sort((a, b) => b.length - a.length);
    const operatorPattern = sortedOps.map(op => escapeRegex(op)).join('|');
    repository['operator'] = {
      match: operatorPattern,
      name: `keyword.operator.${languageId}`,
    };
    patternIncludes.push('operator');
  }

  // Build patterns array — comments first (highest priority), then strings, numbers, keywords, operators
  const orderedKeys = [
    ...patternIncludes.filter(k => classifyTokenRule(k) === 'comment'),
    ...patternIncludes.filter(k => classifyTokenRule(k) === 'string'),
    ...patternIncludes.filter(k => classifyTokenRule(k) === 'number'),
    ...patternIncludes.filter(k => classifyTokenRule(k) === 'boolean'),
    ...patternIncludes.filter(k => k === 'keyword'),
    ...patternIncludes.filter(k => k === 'operator'),
  ];

  const grammar: TextMateGrammar = {
    name: definition.name,
    scopeName: `source.${languageId}`,
    patterns: orderedKeys.map(key => ({ include: `#${key}` })),
    repository,
  };

  return JSON.stringify(grammar, null, 2) + '\n';
}
