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

