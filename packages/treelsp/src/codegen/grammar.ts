/**
 * Grammar codegen
 * Emits grammar.js for Tree-sitter from language definition
 */

import type { LanguageDefinition, RuleDefinition, RuleFn, RuleBuilder } from '../definition/index.js';

/**
 * Internal representation of rule nodes
 * These nodes form an AST of the grammar rules
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
 * Grammar builder implementation
 * Creates RuleNode instances that can be serialized to Tree-sitter grammar.js
 */
class GrammarBuilder<T extends string> implements RuleBuilder<T> {
  seq(...rules: RuleDefinition<T>[]): RuleNode {
    return {
      type: 'seq',
      rules: rules.map(r => this.normalize(r)),
    };
  }

  choice(...rules: RuleDefinition<T>[]): RuleNode {
    return {
      type: 'choice',
      rules: rules.map(r => this.normalize(r)),
    };
  }

  optional(rule: RuleDefinition<T>): RuleNode {
    return {
      type: 'optional',
      rule: this.normalize(rule),
    };
  }

  repeat(rule: RuleDefinition<T>): RuleNode {
    return {
      type: 'repeat',
      rule: this.normalize(rule),
    };
  }

  repeat1(rule: RuleDefinition<T>): RuleNode {
    return {
      type: 'repeat1',
      rule: this.normalize(rule),
    };
  }

  field(name: string, rule: RuleDefinition<T>): RuleNode {
    return {
      type: 'field',
      name,
      rule: this.normalize(rule),
    };
  }

  prec = Object.assign(
    (level: number, rule: RuleDefinition<T>): RuleNode => ({
      type: 'prec',
      level,
      rule: this.normalize(rule),
    }),
    {
      left: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.left',
        level,
        rule: this.normalize(rule),
      }),
      right: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.right',
        level,
        rule: this.normalize(rule),
      }),
      dynamic: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.dynamic',
        level,
        rule: this.normalize(rule),
      }),
    }
  );

  token = Object.assign(
    (pattern: string | RegExp): RuleNode => ({
      type: 'token',
      pattern,
    }),
    {
      immediate: (rule: RuleDefinition<T>): RuleNode => ({
        type: 'token.immediate',
        rule: this.normalize(rule),
      }),
    }
  );

  alias(rule: RuleDefinition<T>, name: string): RuleNode {
    return {
      type: 'alias',
      rule: this.normalize(rule),
      name,
    };
  }

  rule(name: T): RuleNode {
    return {
      type: 'rule',
      name,
    };
  }

  /**
   * Normalize a RuleDefinition into a RuleNode
   * Handles strings, regexes, functions, and existing nodes
   */
  private normalize(rule: RuleDefinition<T>): RuleNode {
    if (typeof rule === 'string') {
      return { type: 'string', value: rule };
    }
    if (rule instanceof RegExp) {
      return { type: 'regex', value: rule };
    }
    if (typeof rule === 'function') {
      return rule(this) as RuleNode;
    }
    // If it's already a RuleNode (returned from a builder method), use it directly
    return rule as RuleNode;
  }
}

/**
 * Serialize a RuleNode to JavaScript code
 */
function serializeNode(node: RuleNode, indent = 0): string {
  const ind = '  '.repeat(indent);

  switch (node.type) {
    case 'string':
      return JSON.stringify(node.value);

    case 'regex':
      return node.value.toString();

    case 'seq':
      if (node.rules.length === 0) return 'seq()';
      if (node.rules.length === 1) {
        return `seq(${serializeNode(node.rules[0]!, indent)})`;
      }
      return `seq(\n${node.rules.map(r => `${ind}  ${serializeNode(r, indent + 1)}`).join(',\n')}\n${ind})`;

    case 'choice':
      if (node.rules.length === 0) return 'choice()';
      if (node.rules.length === 1) {
        return `choice(${serializeNode(node.rules[0]!, indent)})`;
      }
      return `choice(\n${node.rules.map(r => `${ind}  ${serializeNode(r, indent + 1)}`).join(',\n')}\n${ind})`;

    case 'optional':
      return `optional(${serializeNode(node.rule, indent)})`;

    case 'repeat':
      return `repeat(${serializeNode(node.rule, indent)})`;

    case 'repeat1':
      return `repeat1(${serializeNode(node.rule, indent)})`;

    case 'field':
      return `field(${JSON.stringify(node.name)}, ${serializeNode(node.rule, indent)})`;

    case 'prec':
      return `prec(${node.level}, ${serializeNode(node.rule, indent)})`;

    case 'prec.left':
      return `prec.left(${node.level}, ${serializeNode(node.rule, indent)})`;

    case 'prec.right':
      return `prec.right(${node.level}, ${serializeNode(node.rule, indent)})`;

    case 'prec.dynamic':
      return `prec.dynamic(${node.level}, ${serializeNode(node.rule, indent)})`;

    case 'token':
      const pattern = typeof node.pattern === 'string'
        ? JSON.stringify(node.pattern)
        : node.pattern.toString();
      return `token(${pattern})`;

    case 'token.immediate':
      return `token.immediate(${serializeNode(node.rule, indent)})`;

    case 'alias':
      return `alias(${serializeNode(node.rule, indent)}, ${JSON.stringify(node.name)})`;

    case 'rule':
      return `$.${node.name}`;

    default:
      // Type narrowing - this should never happen
      const _exhaustive: never = node;
      throw new Error(`Unknown node type: ${(_exhaustive as any).type}`);
  }
}

/**
 * Generate Tree-sitter grammar.js from language definition
 */
export function generateGrammar<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const builder = new GrammarBuilder<T>();

  // Build all rules
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(definition.grammar)) {
    rules[name] = (ruleFn as RuleFn<T>)(builder) as RuleNode;
  }

  // Generate rules section
  const rulesCode = Object.entries(rules)
    .map(([name, node]) => {
      const serialized = serializeNode(node, 2);
      return `    ${name}: $ => ${serialized}`;
    })
    .join(',\n\n');

  // Generate word config
  const wordLine = definition.word
    ? `  word: $ => $.${definition.word},\n\n`
    : '';

  // Generate conflicts config
  let conflictsLine = '';
  if (definition.conflicts) {
    const conflictNodes = definition.conflicts(builder);
    const conflictsSerialized = conflictNodes
      .map((group: unknown[]) => {
        const items = group.map((node: unknown) => serializeNode(node as RuleNode, 2)).join(', ');
        return `    [${items}]`;
      })
      .join(',\n');
    conflictsLine = `  conflicts: $ => [\n${conflictsSerialized}\n  ],\n\n`;
  }

  // Generate full grammar.js
  return `/**
 * Tree-sitter grammar for ${definition.name}
 * Generated by treelsp - do not edit manually
 */

module.exports = grammar({
  name: ${JSON.stringify(definition.name)},

${wordLine}${conflictsLine}  rules: {
${rulesCode}
  }
});
`;
}
