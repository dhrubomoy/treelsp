/**
 * External scanner for IndentLang
 *
 * Handles INDENT / DEDENT / NEWLINE tokens for Python-style indentation.
 * Token indices must match the `externals` order in grammar.ts:
 *   0 = INDENT, 1 = DEDENT, 2 = NEWLINE
 *
 * Design:
 *   NEWLINE handler consumes \n, skips blank lines, advances through leading
 *   whitespace of the next meaningful line, and uses the resulting column to
 *   update the indent stack.  INDENT / DEDENT are emitted as zero-width tokens
 *   on subsequent scan calls via pending flags.
 */

#include "tree_sitter/parser.h"

#include <string.h>

enum TokenType {
  INDENT,
  DEDENT,
  NEWLINE,
};

#define MAX_DEPTH 100

typedef struct {
  uint16_t indents[MAX_DEPTH];
  uint8_t depth;
  uint8_t queued_dedents;
  bool pending_indent;
} Scanner;

/* ── Lifecycle ──────────────────────────────────────────────── */

void *tree_sitter_IndentLang_external_scanner_create(void) {
  Scanner *s = calloc(1, sizeof(Scanner));
  /* indents[0] = 0 (top-level column) is set by calloc */
  return s;
}

void tree_sitter_IndentLang_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned tree_sitter_IndentLang_external_scanner_serialize(
    void *payload, char *buffer) {
  Scanner *s = (Scanner *)payload;
  unsigned size = 0;
  buffer[size++] = (char)s->depth;
  buffer[size++] = (char)s->queued_dedents;
  buffer[size++] = (char)s->pending_indent;
  for (uint8_t i = 0; i <= s->depth; i++) {
    if (size + 2 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) break;
    buffer[size++] = (char)(s->indents[i] & 0xFF);
    buffer[size++] = (char)((s->indents[i] >> 8) & 0xFF);
  }
  return size;
}

void tree_sitter_IndentLang_external_scanner_deserialize(
    void *payload, const char *buffer, unsigned length) {
  Scanner *s = (Scanner *)payload;
  if (length == 0) {
    s->depth = 0;
    s->indents[0] = 0;
    s->queued_dedents = 0;
    s->pending_indent = false;
    return;
  }
  unsigned pos = 0;
  s->depth = (uint8_t)buffer[pos++];
  s->queued_dedents = (uint8_t)buffer[pos++];
  s->pending_indent = (bool)buffer[pos++];
  for (uint8_t i = 0; i <= s->depth && pos + 1 < length; i++) {
    s->indents[i] =
        (uint16_t)((uint8_t)buffer[pos] | ((uint8_t)buffer[pos + 1] << 8));
    pos += 2;
  }
}

/* ── Scan ───────────────────────────────────────────────────── */

bool tree_sitter_IndentLang_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *s = (Scanner *)payload;

  /* 1. Emit queued DEDENTs (highest priority) */
  if (s->queued_dedents > 0 && valid_symbols[DEDENT]) {
    s->queued_dedents--;
    lexer->result_symbol = DEDENT;
    return true;
  }

  /* 2. Emit pending INDENT (set by previous NEWLINE scan) */
  if (s->pending_indent && valid_symbols[INDENT]) {
    s->pending_indent = false;
    lexer->result_symbol = INDENT;
    return true;
  }

  /* 3. NEWLINE — consume \n, skip blank lines, measure next indent */
  if (valid_symbols[NEWLINE] &&
      (lexer->lookahead == '\n' || lexer->lookahead == '\r')) {

    /* Consume the newline character(s) */
    if (lexer->lookahead == '\r') lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') lexer->advance(lexer, false);
    lexer->mark_end(lexer);

    /* Skip blank lines (whitespace-only lines) */
    for (;;) {
      while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, false);
      }
      if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
        if (lexer->lookahead == '\r') lexer->advance(lexer, false);
        if (lexer->lookahead == '\n') lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        continue;
      }
      break;
    }

    /* The column at this point is the indentation of the next line */
    uint16_t indent = (uint16_t)lexer->get_column(lexer);
    uint16_t current = s->indents[s->depth];

    if (!lexer->eof(lexer)) {
      if (indent > current) {
        /* Indentation increased — push level, flag for next call */
        if (s->depth + 1 < MAX_DEPTH) {
          s->depth++;
          s->indents[s->depth] = indent;
        }
        s->pending_indent = true;
      } else if (indent < current) {
        /* Indentation decreased — pop levels, queue DEDENTs */
        while (s->depth > 0 && s->indents[s->depth] > indent) {
          s->depth--;
          s->queued_dedents++;
        }
      }
    }

    lexer->result_symbol = NEWLINE;
    return true;
  }

  /* 4. EOF — emit remaining DEDENTs to close all open blocks */
  if (lexer->eof(lexer) && valid_symbols[DEDENT] && s->depth > 0) {
    s->depth--;
    s->queued_dedents = s->depth;
    lexer->result_symbol = DEDENT;
    return true;
  }

  return false;
}
