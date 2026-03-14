import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// --------- Response helpers ---------

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

function extractImage(content: McpContent[]): { data: string; mimeType: string } | null {
  const block = content.find((c): c is McpImageContent => c.type === 'image');
  return block ? { data: block.data, mimeType: block.mimeType } : null;
}


// --------- Tool wrappers ---------

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<McpContent[]> {
  const result = await client.callTool({ name, arguments: args });
  return result.content as McpContent[];
}

/** Navigate to a URL. Returns the ARIA snapshot of the loaded page. */
export async function navigate(client: Client, url: string): Promise<string> {
  const content = await callTool(client, 'browser_navigate', { url });
  return extractText(content);
}

/** Get the accessibility (ARIA) tree snapshot. */
export async function snapshot(client: Client, selector?: string): Promise<string> {
  const args: Record<string, unknown> = {};
  if (selector) args.selector = selector;
  const content = await callTool(client, 'browser_snapshot', args);
  return extractText(content);
}

/** Take a screenshot. Returns base64-encoded image data. */
export async function screenshot(
  client: Client,
  options?: { element?: string; ref?: string; selector?: string; fullPage?: boolean }
): Promise<{ data: string; mimeType: string } | null> {
  const content = await callTool(client, 'browser_take_screenshot', {
    type: 'png',
    ...options,
  });
  return extractImage(content);
}

/** Evaluate a JavaScript function in the page context. */
export async function evaluate(client: Client, fn: string, selector?: string): Promise<string> {
  const args: Record<string, unknown> = { function: fn };
  if (selector) args.selector = selector;
  const content = await callTool(client, 'browser_evaluate', args);
  return extractText(content);
}

/** Press a key or key combination (e.g. 'Tab', 'Escape', 'Shift+Tab'). */
export async function pressKey(client: Client, key: string): Promise<string> {
  const content = await callTool(client, 'browser_press_key', { key });
  return extractText(content);
}

/** Click an element by ref (from a previous snapshot). */
export async function click(client: Client, ref: string, element?: string): Promise<string> {
  const args: Record<string, unknown> = { ref };
  if (element) args.element = element;
  const content = await callTool(client, 'browser_click', args);
  return extractText(content);
}

/** Wait for text to appear or a timeout. */
export async function waitFor(client: Client, options: { text?: string; time?: number }): Promise<string> {
  const content = await callTool(client, 'browser_wait_for', options);
  return extractText(content);
}

/** Close the browser. */
export async function closeBrowser(client: Client): Promise<void> {
  await callTool(client, 'browser_close');
}