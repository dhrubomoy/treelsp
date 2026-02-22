/**
 * schema-lang — A type/schema definition language for treelsp
 * Declarative language with types, fields, enums, and type references
 */

import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'SchemaLang',
  fileExtensions: ['.schema'],
  entry: 'schema',
  word: 'identifier',

  extras: r => [/\s+/, r.comment],

  grammar: {
    // Schema is a sequence of declarations
    schema: r => r.repeat(r.declaration),

    // Declarations
    declaration: r => r.choice(
      r.type_decl,
      r.enum_decl,
    ),

    // Type declaration: type Name { fields }
    type_decl: r => r.seq(
      'type',
      r.field('name', r.identifier),
      '{',
      r.repeat(r.field_decl),
      '}',
    ),

    // Field declaration: name: type_ref
    field_decl: r => r.seq(
      r.field('name', r.identifier),
      ':',
      r.field('type', r.type_ref),
    ),

    // Enum declaration: enum Name { variants }
    enum_decl: r => r.seq(
      'enum',
      r.field('name', r.identifier),
      '{',
      r.repeat(r.variant),
      '}',
    ),

    // Enum variant: just a name
    variant: r => r.field('name', r.identifier),

    // Type reference — wraps identifier with reference semantics
    type_ref: r => r.identifier,

    // Tokens
    identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    comment: r => r.token(/\/\/.*/),
  },

  semantic: {
    // Schema creates global scope
    schema: { scope: 'global' },

    // Type declarations introduce names and create scope for fields
    type_decl: {
      scope: 'lexical',
      declares: {
        field: 'name',
        scope: 'enclosing',
        visibility: 'public',
      },
    },

    // Enum declarations introduce names and create scope for variants
    enum_decl: {
      scope: 'lexical',
      declares: {
        field: 'name',
        scope: 'enclosing',
        visibility: 'public',
      },
    },

    // Field declarations introduce names in local (type) scope
    field_decl: {
      declares: {
        field: 'name',
        scope: 'local',
      },
    },

    // Enum variants introduce names in local (enum) scope
    variant: {
      declares: {
        field: 'name',
        scope: 'local',
      },
    },

    // Type references resolve to type or enum declarations
    type_ref: {
      references: {
        field: 'name',
        to: ['type_decl', 'enum_decl'],
        onUnresolved: 'error',
      },
    },
  },

  validation: {
    // Type must have at least one field
    type_decl(node, ctx) {
      const fields = node.descendantsOfType('field_decl');
      if (fields.length === 0) {
        ctx.error(node, 'Type must have at least one field');
      }
    },
  },

  lsp: {
    // Keyword completions
    $keywords: {
      'type': { detail: 'Declare a type' },
      'enum': { detail: 'Declare an enum' },
    },

    // Hover and symbols for types
    type_decl: {
      completionKind: 'Class',
      symbol: {
        kind: 'Class',
        label: n => n.field('name').text,
      },
      hover(node) {
        const name = node.field('name').text;
        const fieldCount = node.descendantsOfType('field_decl').length;
        return `**type** \`${name}\` (${fieldCount} field${fieldCount !== 1 ? 's' : ''})`;
      },
    },

    // Hover and symbols for enums
    enum_decl: {
      completionKind: 'Enum',
      symbol: {
        kind: 'Enum',
        label: n => n.field('name').text,
      },
      hover(node) {
        const name = node.field('name').text;
        const variantCount = node.descendantsOfType('variant').length;
        return `**enum** \`${name}\` (${variantCount} variant${variantCount !== 1 ? 's' : ''})`;
      },
    },

    // Hover and symbols for fields
    field_decl: {
      completionKind: 'Property',
      symbol: {
        kind: 'Property',
        label: n => n.field('name').text,
        detail: n => n.field('type')?.text,
      },
      hover(node) {
        const name = node.field('name').text;
        const type = node.field('type')?.text ?? 'unknown';
        return `**field** \`${name}\`: \`${type}\``;
      },
    },

    // Symbols for enum variants
    variant: {
      completionKind: 'EnumMember',
      symbol: {
        kind: 'EnumMember',
        label: n => n.field('name').text,
      },
    },
  },
});
