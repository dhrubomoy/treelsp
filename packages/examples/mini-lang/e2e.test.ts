/**
 * End-to-end pipeline test for mini-lang
 *
 * Spawns the actual server.bundle.cjs over stdio and exercises the LSP
 * protocol: initialize, didOpen, hover, definition, completion, shutdown.
 *
 * Requires a built server bundle — run "treelsp build" first.
 * Skipped automatically if server.bundle.cjs is not found.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverBundle = resolve(__dirname, 'generated', 'server.bundle.cjs');
const hasBundle = existsSync(serverBundle);

/**
 * Minimal JSON-RPC / LSP client over stdio
 */
class LspClient {
  private process: ChildProcess;
  private buffer = '';
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(bundlePath: string) {
    this.process = spawn('node', [bundlePath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });
  }

  private processBuffer(): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) break;

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      const msg = JSON.parse(body);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result);
        }
      }
    }
  }

  send(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
    this.process.stdin!.write(header + msg);
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`;
    this.process.stdin!.write(header + msg);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async shutdown(): Promise<void> {
    await this.request('shutdown', null);
    this.send('exit', null);
    this.process.kill();
  }
}

describe.skipIf(!hasBundle)('mini-lang e2e pipeline (server.bundle.cjs)', () => {
  let client: LspClient;

  beforeAll(async () => {
    client = new LspClient(serverBundle);

    // Initialize
    const initResult = await client.request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    expect(initResult.capabilities).toBeDefined();

    client.send('initialized', {});

    // Open a document
    client.send('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///test.mini',
        languageId: 'minilang',
        version: 1,
        text: 'let x = 10;\nlet y = x;\n',
      },
    });

    // Give the server time to parse
    await new Promise(r => setTimeout(r, 500));
  });

  afterAll(async () => {
    if (client) {
      await client.shutdown();
    }
  });

  it('responds to initialize with expected capabilities', async () => {
    const result = await client.request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });

    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.referencesProvider).toBe(true);
    expect(result.capabilities.completionProvider).toBeDefined();
    expect(result.capabilities.renameProvider).toEqual({ prepareProvider: true });
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    expect(result.capabilities.semanticTokensProvider).toBeDefined();
  });

  it('provides hover on a variable reference', async () => {
    const result = await client.request('textDocument/hover', {
      textDocument: { uri: 'file:///test.mini' },
      position: { line: 1, character: 8 }, // 'x' in 'let y = x;'
    });

    expect(result).not.toBeNull();
    expect(result.contents).toBeDefined();
  });

  it('provides go-to-definition for a reference', async () => {
    const result = await client.request('textDocument/definition', {
      textDocument: { uri: 'file:///test.mini' },
      position: { line: 1, character: 8 }, // 'x' reference
    });

    expect(result).not.toBeNull();
    expect(result.uri).toBe('file:///test.mini');
    // Should point to 'let x' on line 0
    expect(result.range.start.line).toBe(0);
  });

  it('provides completion items', async () => {
    const result = await client.request('textDocument/completion', {
      textDocument: { uri: 'file:///test.mini' },
      position: { line: 1, character: 8 }, // cursor after 'x'
    });

    expect(Array.isArray(result)).toBe(true);
    // Should include at least 'x' and 'y' from scope + keywords like 'let'
    const labels = result.map((item: any) => item.label);
    expect(labels).toContain('x');
  });

  it('provides document symbols', async () => {
    const result = await client.request('textDocument/documentSymbol', {
      textDocument: { uri: 'file:///test.mini' },
    });

    expect(Array.isArray(result)).toBe(true);
  });

  it('provides semantic tokens', async () => {
    const result = await client.request('textDocument/semanticTokens/full', {
      textDocument: { uri: 'file:///test.mini' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('handles incremental document changes', async () => {
    // Make an edit: add 'let z = y;' on line 2
    client.send('textDocument/didChange', {
      textDocument: { uri: 'file:///test.mini', version: 2 },
      contentChanges: [{
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
        text: 'let z = y;\n',
      }],
    });

    await new Promise(r => setTimeout(r, 200));

    // Now hover on the new 'y' reference
    const result = await client.request('textDocument/hover', {
      textDocument: { uri: 'file:///test.mini' },
      position: { line: 2, character: 8 }, // 'y' in 'let z = y;'
    });

    expect(result).not.toBeNull();
  });
});
