import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

interface McpTextContent {
  type: 'text';
  text: string;
}

interface McpImageContent {
  type: 'image';
  data: string; // Base64-encoded image data
  mimeType: string; // e.g., 'image/png'
}

type McpContent = McpTextContent | McpImageContent;

function extractText(content: McpContent[]): string {
  const block = content.find((c): c is McpTextContent => c.type === 'text');
  return block?.text ?? '';
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<McpContent[]> {
  const result = await client.callTool({ name, arguments: args });
  return result.content as McpContent[];
}

export async function navigate(client: Client, url: string): Promise<string> {
  const content = await callTool(client, 'browser_navigate', { url });
  return extractText(content);
}