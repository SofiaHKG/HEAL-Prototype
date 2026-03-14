import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function createMcpClient() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      '@playwright/mcp', 
      '--headless'
    ],
  });
  const client = new Client({ name: 'HEAL MCP Client', version: '1.0.0' }, {});
  await client.connect(transport);
  return client;
}