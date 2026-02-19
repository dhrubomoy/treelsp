/**
 * Lezer grammar codegen
 * Emits a .grammar file for @lezer/generator from a language definition
 */

import type { LanguageDefinition, RuleDefinition, RuleFn, RuleBuilder } from '../../definition/index.js';

/**
 * Internal representation of rule nodes (shared with tree-sitter codegen)
 */
type RuleNode =
  | { type: 'string'; value: string }
  | { type: 'regex'; value: RegExp }
  | { type: 'seq'; rules: RuleNode[] }
  | { type: 'choice'; rules: RuleNode[] }
  | { type: 'optional'; rule: RuleNode }
  | { type: 'repeat'; rule: RuleNode }
  | { type: 'repeat1'; rule: RuleNode }
  | { type: 'field'; name: string; rule: RuleNode }
  | { type: 'prec'; level: number; rule: RuleNode }
  | { type: 'prec.left'; level: number; rule: RuleNode }
  | { type: 'prec.right'; level: number; rule: RuleNode }
  | { type: 'prec.dynamic'; level: number; rule: RuleNode }
  | { type: 'token'; pattern: string | RegExp }
  | { type: 'token.immediate'; rule: RuleNode }
  | { type: 'alias'; rule: RuleNode; name: string }
  | { type: 'rule'; name: string };

/**
 * Builder that captures rule structure for Lezer grammar generation
 */
class LezerGrammarBuilder<T extends string> {
  seq(...rules: RuleDefinition<T>[]): RuleNode {
    return { type: 'seq', rules: rules.map(r => this.normalize(r)) };
  }

  choice(...rules: RuleDefinition<T>[]): RuleNode {
    return { type: 'choice', rules: rules.map(r => this.normalize(r)) };
  }

  optional(rule: RuleDefinition<T>): RuleNode {
    return { type: 'optional', rule: this.normalize(rule) };
  }

  repeat(rule: RuleDefinition<T>): RuleNode {
    return { type: 'repeat', rule: this.normalize(rule) };
  }

  repeat1(rule: RuleDefinition<T>): RuleNode {
    return { type: 'repeat1', rule: this.normalize(rule) };
  }

  field(name: string, rule: RuleDefinition<T>): RuleNode {
    return { type: 'field', name, rule: this.normalize(rule) };
  }

  prec = Object.assign(
    (level: number, rule: RuleDefinition<T>): RuleNode => ({
      type: 'prec', level, rule: this.normalize(rule),
    }),
    {
      left: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.left', level, rule: this.normalize(rule),
      }),
      right: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.right', level, rule: this.normalize(rule),
      }),
      dynamic: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.dynamic', level, rule: this.normalize(rule),
      }),
    }
  );

  token = Object.assign(
    (pattern: string | RegExp): RuleNode => ({ type: 'token', pattern }),
    {
      immediate: (rule: RuleDefinition<T>): RuleNode => ({
        type: 'token.immediate', rule: this.normalize(rule),
      }),
    }
  );

  alias(rule: RuleDefinition<T>, name: string): RuleNode {
    return { type: 'alias', rule: this.normalize(rule), name };
  }

  rule(name: T): RuleNode {
    return { type: 'rule', name };
  }

  private normalize(rule: RuleDefinition<T>): RuleNode {
    if (typeof rule === 'string') return { type: 'string', value: rule };
    if (rule instanceof RegExp) return { type: 'regex', value: rule };
    if (typeof rule === 'function') {
      return rule(this as unknown as RuleBuilder<T>) as unknown as RuleNode;
    }
    return rule as unknown as RuleNode;
  }
}

/**
 * Convert snake_case to PascalCase
 * e.g., "variable_decl" → "VariableDecl", "identifier" → "Identifier"
 */
export function toPascalCase(name: string): string {
  return name
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Collect all precedence levels used in a rule tree.
 * Returns a set of { level, assoc } entries.
 */
interface PrecEntry {
  level: number;
  assoc: 'left' | 'right' | 'none';
}

function collectPrecedences(node: RuleNode, out: PrecEntry[]): void {
  switch (node.type) {
    case 'prec':
      out.push({ level: node.level, assoc: 'none' });
      collectPrecedences(node.rule, out);
      break;
    case 'prec.left':
      out.push({ level: node.level, assoc: 'left' });
      collectPrecedences(node.rule, out);
      break;
    case 'prec.right':
      out.push({ level: node.level, assoc: 'right' });
      collectPrecedences(node.rule, out);
      break;
    case 'prec.dynamic':
      out.push({ level: node.level, assoc: 'none' });
      collectPrecedences(node.rule, out);
      break;
    case 'seq':
    case 'choice':
      for (const child of node.rules) {
        collectPrecedences(child, out);
      }
      break;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      collectPrecedences(node.rule, out);
      break;
    case 'field':
      collectPrecedences(node.rule, out);
      break;
    case 'alias':
      collectPrecedences(node.rule, out);
      break;
    // string, regex, token, rule — no precedences
  }
}

/**
 * Collect all string literals that should be treated as keywords.
 * A string literal is a keyword if it's alphabetic and the grammar has a `word` rule.
 */
function collectKeywords(
  rules: Record<string, RuleNode>,
  wordRule: string | undefined,
  lspKeywords: Record<string, unknown> | undefined,
): Set<string> {
  const keywords = new Set<string>();
  if (!wordRule) return keywords;

  const allStrings = new Set<string>();
  for (const ruleNode of Object.values(rules)) {
    collectStrings(ruleNode, allStrings);
  }

  for (const str of allStrings) {
    // Alphabetic strings are keywords when there's a word rule
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str)) {
      keywords.add(str);
    }
  }

  // Also include explicit $keywords
  if (lspKeywords) {
    for (const kw of Object.keys(lspKeywords)) {
      keywords.add(kw);
    }
  }

  return keywords;
}

function collectStrings(node: RuleNode, out: Set<string>): void {
  switch (node.type) {
    case 'string':
      out.add(node.value);
      break;
    case 'seq':
    case 'choice':
      for (const child of node.rules) {
        collectStrings(child, out);
      }
      break;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      collectStrings(node.rule, out);
      break;
    case 'field':
      collectStrings(node.rule, out);
      break;
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      collectStrings(node.rule, out);
      break;
    case 'alias':
      collectStrings(node.rule, out);
      break;
    // token, regex, rule — no string literals
  }
}

/**
 * Convert a JS regex to Lezer @tokens syntax.
 *
 * Lezer token syntax:
 *   $[a-z]      character class
 *   !$[\n]      negated character class
 *   "literal"   literal string
 *   (a b)       grouping / sequence
 *   a | b       alternation
 *   a+ a* a?    quantifiers
 *
 * Strategy: walk the regex source, batch consecutive literal characters
 * into a single quoted string, emit character classes directly.
 */
function regexToLezerToken(regex: RegExp): string {
  return convertRegexPart(regex.source);
}

function convertRegexPart(src: string): string {
  const pieces: string[] = [];
  let literalBuf = ''; // accumulates literal characters to batch-quote

  function flushLiterals(): void {
    if (literalBuf.length > 0) {
      // Use single quotes if the buffer contains double-quotes, else double
      if (literalBuf.includes('"')) {
        pieces.push(`'${literalBuf}'`);
      } else {
        pieces.push(`"${literalBuf}"`);
      }
      literalBuf = '';
    }
  }

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    if (ch === '[') {
      flushLiterals();
      const end = findClosingBracket(src, i);
      const inner = src.slice(i + 1, end); // content between [ and ]
      if (inner.startsWith('^')) {
        pieces.push(`![${inner.slice(1)}]`);
      } else {
        pieces.push(`$[${inner}]`);
      }
      i = end + 1;
    } else if (ch === '\\') {
      const next = src[i + 1];
      if (next === 's') {
        flushLiterals();
        pieces.push('$[ \\t\\n\\r]');
        i += 2;
      } else if (next === 'S') {
        flushLiterals();
        pieces.push('![ \\t\\n\\r]');
        i += 2;
      } else if (next === 'd') {
        flushLiterals();
        pieces.push('$[0-9]');
        i += 2;
      } else if (next === 'D') {
        flushLiterals();
        pieces.push('![0-9]');
        i += 2;
      } else if (next === 'w') {
        flushLiterals();
        pieces.push('$[a-zA-Z0-9_]');
        i += 2;
      } else if (next === 'W') {
        flushLiterals();
        pieces.push('![a-zA-Z0-9_]');
        i += 2;
      } else if (next === 'n') {
        literalBuf += '\\n';
        i += 2;
      } else if (next === 't') {
        literalBuf += '\\t';
        i += 2;
      } else if (next === 'r') {
        literalBuf += '\\r';
        i += 2;
      } else {
        // Escaped literal (e.g., \/ → /, \. → ., \\ → \)
        literalBuf += (next ?? '');
        i += 2;
      }
    } else if (ch === '.') {
      flushLiterals();
      pieces.push('![\\n]');
      i++;
    } else if (ch === '(') {
      flushLiterals();
      const end = findClosingParen(src, i);
      let groupContent = src.slice(i + 1, end);
      if (groupContent.startsWith('?:')) {
        groupContent = groupContent.slice(2);
      }
      pieces.push('(' + convertRegexPart(groupContent) + ')');
      i = end + 1;
    } else if (ch === '|') {
      flushLiterals();
      pieces.push('|');
      i++;
    } else if (ch === '+' || ch === '*' || ch === '?') {
      // Quantifier applies to the last piece
      flushLiterals();
      // If there's a preceding piece, append the quantifier to it
      if (pieces.length > 0) {
        pieces[pieces.length - 1] += ch;
      }
      i++;
    } else if (ch === '^' || ch === '$') {
      // Anchors — skip (Lezer tokens don't use them)
      i++;
    } else {
      // Regular literal character
      literalBuf += ch;
      i++;
    }
  }

  flushLiterals();

  // Join pieces with spaces (Lezer token syntax uses space for sequence)
  return pieces.join(' ');
}

function escapeLezerString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function findClosingBracket(src: string, start: number): number {
  let i = start + 1;
  if (i < src.length && src[i] === '^') i++;
  if (i < src.length && src[i] === ']') i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === ']') return i;
    i++;
  }
  return src.length - 1;
}

function findClosingParen(src: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '(') depth++;
    if (src[i] === ')') depth--;
    if (depth > 0) i++;
  }
  return i;
}

/**
 * Serialize a RuleNode to Lezer grammar syntax
 */
function serializeNode(
  node: RuleNode,
  tokenRules: Set<string>,
  keywords: Set<string>,
  wordRule: string | undefined,
  externalRules: Set<string>,
): string {
  switch (node.type) {
    case 'string': {
      // If this is a keyword and there's a word rule, use kw<"...">
      if (wordRule && keywords.has(node.value)) {
        return `kw<"${escapeLezerString(node.value)}">`;
      }
      return `"${escapeLezerString(node.value)}"`;
    }

    case 'regex':
      // Inline regex is unusual in Lezer rules — typically in @tokens
      // Convert to Lezer token syntax
      return regexToLezerToken(node.value);

    case 'seq': {
      if (node.rules.length === 0) return '""';
      const parts = node.rules.map(r =>
        serializeNode(r, tokenRules, keywords, wordRule, externalRules)
      );
      return parts.join(' ');
    }

    case 'choice': {
      if (node.rules.length === 0) return '""';
      const parts = node.rules.map(r =>
        serializeNode(r, tokenRules, keywords, wordRule, externalRules)
      );
      if (parts.length === 1) return parts[0]!;
      return parts.join(' | ');
    }

    case 'optional':
      return wrapIfComplex(
        serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules),
        node.rule,
      ) + '?';

    case 'repeat':
      return wrapIfComplex(
        serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules),
        node.rule,
      ) + '*';

    case 'repeat1':
      return wrapIfComplex(
        serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules),
        node.rule,
      ) + '+';

    case 'field':
      // Lezer doesn't have field names — just emit the child rule
      // Field info is captured in the metadata file
      return serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules);

    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic': {
      const precName = `prec${node.level >= 0 ? node.level : '_neg' + Math.abs(node.level)}`;
      const inner = serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules);
      return `!${precName} ${inner}`;
    }

    case 'token': {
      // Token rules are defined in @tokens{} block, not inline
      // This shouldn't appear in rule bodies since token rules
      // are handled separately
      if (typeof node.pattern === 'string') {
        return `"${escapeLezerString(node.pattern)}"`;
      }
      return regexToLezerToken(node.pattern);
    }

    case 'token.immediate':
      // Lezer handles immediate tokens differently
      return serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules);

    case 'alias':
      // Alias is not directly supported in Lezer
      return serializeNode(node.rule, tokenRules, keywords, wordRule, externalRules);

    case 'rule': {
      // External rules are referenced by their PascalCase name
      // (they're declared in @external tokens)
      const pascalName = toPascalCase(node.name);
      return pascalName;
    }

    default: {
      const _exhaustive: never = node;
      throw new Error(`Unknown node type: ${(_exhaustive as RuleNode).type}`);
    }
  }
}

/**
 * Wrap in parentheses if the node is a choice or seq (complex)
 */
function wrapIfComplex(serialized: string, node: RuleNode): string {
  if (node.type === 'choice' || node.type === 'seq') {
    return `(${serialized})`;
  }
  return serialized;
}

/**
 * Generate a Lezer @tokens block entry for a token rule
 */
function generateTokenEntry(name: string, node: RuleNode): string {
  const pascalName = toPascalCase(name);

  if (node.type === 'token') {
    if (typeof node.pattern === 'string') {
      return `  ${pascalName} { "${escapeLezerString(node.pattern)}" }`;
    }
    return `  ${pascalName} { ${regexToLezerToken(node.pattern)} }`;
  }

  // Fallback for non-token rules that ended up here
  return `  ${pascalName} { $[a-zA-Z]+ }`;
}

/**
 * Build the @precedence declaration
 */
function buildPrecedenceDecl(rules: Record<string, RuleNode>): string {
  const allPrecs: PrecEntry[] = [];
  for (const ruleNode of Object.values(rules)) {
    collectPrecedences(ruleNode, allPrecs);
  }

  if (allPrecs.length === 0) return '';

  // Deduplicate and sort by level (highest first — Lezer precedences are
  // listed from highest to lowest)
  const seen = new Map<string, PrecEntry>();
  for (const entry of allPrecs) {
    const key = `${entry.level}:${entry.assoc}`;
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  }

  const sorted = [...seen.values()].sort((a, b) => b.level - a.level);

  const entries = sorted.map(e => {
    const name = `prec${e.level >= 0 ? e.level : '_neg' + Math.abs(e.level)}`;
    if (e.assoc === 'left') return `${name} @left`;
    if (e.assoc === 'right') return `${name} @right`;
    return name;
  });

  return `@precedence { ${entries.join(', ')} }`;
}

/**
 * Get the literal string prefix a token rule starts with, if deterministic.
 * Used to detect overlapping tokens (e.g., Comment "//" vs operator "/").
 */
function getTokenPrefix(node: RuleNode): string | null {
  switch (node.type) {
    case 'token':
      if (typeof node.pattern === 'string') return node.pattern;
      // For regex tokens, try to extract a literal prefix
      return getRegexLiteralPrefix(node.pattern.source);
    case 'string':
      return node.value;
    case 'seq':
      if (node.rules.length > 0) return getTokenPrefix(node.rules[0]!);
      return null;
    default:
      return null;
  }
}

/**
 * Extract a literal prefix from a regex source string.
 * Returns the longest prefix that consists only of literal characters.
 */
function getRegexLiteralPrefix(src: string): string | null {
  let result = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length) {
      const next = src[i + 1]!;
      // Only literal escapes (not \d, \w, \s, etc.)
      if (/[dDwWsSbB]/.test(next)) break;
      result += next;
      i += 2;
    } else if (/[[\](){}|.*+?^$]/.test(ch)) {
      break;
    } else {
      result += ch;
      i++;
    }
  }
  return result.length > 0 ? result : null;
}

/**
 * Generate Lezer grammar from language definition
 */
export function generateLezerGrammar<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const builder = new LezerGrammarBuilder<T>();

  // Build all rules
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(definition.grammar)) {
    rules[name] = (ruleFn as RuleFn<T>)(builder as unknown as RuleBuilder<T>) as unknown as RuleNode;
  }

  // Validate entry rule exists
  if (!(definition.entry in rules)) {
    const available = Object.keys(rules).sort().join(', ');
    throw new Error(
      `Entry rule '${definition.entry}' is not defined in grammar. Available rules: ${available}`
    );
  }

  // Identify token rules (defined with r.token(...))
  const tokenRules = new Set<string>();
  for (const [name, ruleNode] of Object.entries(rules)) {
    if (ruleNode.type === 'token') {
      tokenRules.add(name);
    }
  }

  // Identify external rules
  const externalRules = new Set<string>();
  if (definition.externals) {
    const rawExternals = definition.externals(builder);
    for (const item of rawExternals) {
      const node = typeof item === 'string'
        ? { type: 'string' as const, value: item }
        : (item as RuleNode);
      if (node.type === 'rule') {
        externalRules.add(node.name);
      }
    }
  }

  // Collect keywords (alphabetic string literals when there's a word rule)
  const keywords = collectKeywords(rules, definition.word, definition.lsp?.$keywords);

  // Build precedence declaration
  const precDecl = buildPrecedenceDecl(rules);

  // Build sections
  const sections: string[] = [];

  sections.push(`// Lezer grammar for ${definition.name}`);
  sections.push('// Generated by treelsp — do not edit');
  sections.push('');

  // @top rule
  const entryPascal = toPascalCase(definition.entry);
  const entryRule = rules[definition.entry]!;
  sections.push(`@top ${entryPascal} { ${serializeNode(entryRule, tokenRules, keywords, definition.word, externalRules)} }`);
  sections.push('');

  // Non-token, non-entry, non-external rules
  for (const [name, ruleNode] of Object.entries(rules)) {
    if (name === definition.entry) continue;
    if (tokenRules.has(name)) continue;
    if (externalRules.has(name)) continue;

    const pascalName = toPascalCase(name);
    const body = serializeNode(ruleNode, tokenRules, keywords, definition.word, externalRules);
    sections.push(`${pascalName} { ${body} }`);
    sections.push('');
  }

  // Keyword helper (if word rule exists)
  if (definition.word && keywords.size > 0) {
    const wordPascal = toPascalCase(definition.word);
    sections.push(`kw<term> { @specialize<${wordPascal}, term> }`);
    sections.push('');
  }

  // @skip
  if (definition.extras) {
    const rawExtras = definition.extras(builder);
    const skipParts: string[] = [];
    for (const item of rawExtras) {
      let node: RuleNode;
      if (typeof item === 'string') {
        node = { type: 'string', value: item } as RuleNode;
      } else if (item instanceof RegExp) {
        node = { type: 'regex', value: item } as RuleNode;
      } else {
        node = item as RuleNode;
      }

      if (node.type === 'rule') {
        // Reference to a grammar rule used as skip
        // If it's a token rule, reference it by PascalCase name
        skipParts.push(toPascalCase(node.name));
      } else if (node.type === 'regex') {
        // Regex extras become named tokens in @tokens — reference by name here
        // The actual token definition is generated in the @tokens block below
        skipParts.push('whitespace');
      } else if (node.type === 'string') {
        skipParts.push(`"${escapeLezerString(node.value)}"`);
      }
    }
    if (skipParts.length > 0) {
      sections.push(`@skip { ${skipParts.join(' | ')} }`);
      sections.push('');
    }
  } else {
    // Default: skip whitespace
    sections.push(`@skip { whitespace }`);
    sections.push('');
  }

  // @external tokens
  if (externalRules.size > 0) {
    const externalNames = [...externalRules].map(name => toPascalCase(name));
    sections.push(`@external tokens externalTokenizer from "./tokens" { ${externalNames.join(', ')} }`);
    sections.push('');
  }

  // @precedence
  if (precDecl) {
    sections.push(precDecl);
    sections.push('');
  }

  // @tokens block
  const tokenEntries: string[] = [];

  // Add defined token rules
  for (const name of tokenRules) {
    const ruleNode = rules[name]!;
    tokenEntries.push(generateTokenEntry(name, ruleNode));
  }

  // Add whitespace token if using default skip or if extras include whitespace regex
  if (!definition.extras) {
    tokenEntries.push('  whitespace { $[ \\t\\n\\r]+ }');
  } else {
    // Check if extras include a regex that matches whitespace
    const rawExtras = definition.extras(builder);
    for (const item of rawExtras) {
      const node = (typeof item === 'string' || item instanceof RegExp)
        ? (item instanceof RegExp ? { type: 'regex' as const, value: item } : null)
        : (item as RuleNode);
      if (node && node.type === 'regex') {
        // Add as a whitespace-like token in @tokens
        // The converted regex may already have a quantifier (e.g., /\s+/ → $[...]+ )
        const converted = regexToLezerToken(node.value);
        const hasQuantifier = /[+*?]$/.test(converted);
        tokenEntries.push(`  whitespace { ${converted}${hasQuantifier ? '' : '+'} }`);
      }
    }
  }

  // Build @precedence inside @tokens to resolve overlapping tokens.
  // Collect all string literals used in grammar rules, then check if any
  // @tokens entry or skip token could start with one of those prefixes.
  const allStrings = new Set<string>();
  for (const ruleNode of Object.values(rules)) {
    collectStrings(ruleNode, allStrings);
  }

  // For each token, get the string prefix it starts with and find conflicts
  // with string literals used in the grammar. Lezer's @precedence inside
  // @tokens must list all conflicting items (token names AND string literals)
  // from highest to lowest priority.
  const precItems: string[] = [];
  const conflictLiterals = new Set<string>();

  for (const name of tokenRules) {
    const ruleNode = rules[name]!;
    const prefix = getTokenPrefix(ruleNode);
    if (prefix) {
      for (const str of allStrings) {
        if (prefix.startsWith(str) && prefix !== str) {
          const pascalName = toPascalCase(name);
          if (!precItems.includes(pascalName)) {
            precItems.push(pascalName);
          }
          conflictLiterals.add(str);
        }
      }
    }
  }

  // Also check skip tokens that aren't in tokenRules (like Comment referenced by rule)
  if (definition.extras) {
    const rawExtras = definition.extras(builder);
    for (const item of rawExtras) {
      const node = (typeof item === 'string' || item instanceof RegExp)
        ? null
        : (item as RuleNode);
      if (node && node.type === 'rule' && !tokenRules.has(node.name) && rules[node.name]) {
        const prefix = getTokenPrefix(rules[node.name]!);
        if (prefix) {
          for (const str of allStrings) {
            if (prefix.startsWith(str) && prefix !== str) {
              const pascalName = toPascalCase(node.name);
              if (!precItems.includes(pascalName)) {
                precItems.push(pascalName);
              }
              conflictLiterals.add(str);
            }
          }
        }
      }
    }
  }

  if (tokenEntries.length > 0) {
    sections.push('@tokens {');
    sections.push(tokenEntries.join('\n'));
    if (precItems.length > 0) {
      // List token names first (higher priority), then conflicting literals
      const allPrecItems = [
        ...precItems,
        ...[...conflictLiterals].map(s => `"${escapeLezerString(s)}"`),
      ];
      sections.push(`  @precedence { ${allPrecItems.join(', ')} }`);
    }
    sections.push('}');
    sections.push('');
  }

  return sections.join('\n');
}
