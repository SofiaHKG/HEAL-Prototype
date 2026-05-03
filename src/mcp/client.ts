import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface CreateMcpClientOptions {
  /** Comma-separated MCP capabilities to enable (e.g. 'devtools' for tracing) */
  caps?: string;
  /** Absolute path to MCP output directory (where traces/snapshots are written) */
  outputDir?: string;
}

export async function createMcpClient(opts: CreateMcpClientOptions = {}) {
  const args = [
    '@playwright/mcp',
    '--headless',
    '--isolated'
  ];
  if (opts.caps) args.push('--caps', opts.caps);
  if (opts.outputDir) args.push('--output-dir', opts.outputDir);

  const transport = new StdioClientTransport({
    command: 'npx',
    args,
  });
  const client = new Client({ name: 'HEAL MCP Client', version: '1.0.0' }, {});
  await client.connect(transport);
  return client;
}