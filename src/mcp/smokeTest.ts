import { createMcpClient } from './client';
import { navigate, snapshot, evaluate, screenshot, pressKey, closeBrowser } from './tools';

const TARGET_URL = '/*URL*/';

// Run test with: npm run smoke
// or: npx ts-node src/mcp/smokeTest.ts
async function runSmokeTest(): Promise<void> {
  console.log('--- Starting HEAL MCP Smoke Test ---\n');

  // 1. Connect
  console.log('1. Connecting to Playwright MCP server...');
  const client = await createMcpClient();
  console.log('[OK] Connected\n');

  try {
    // 2. Navigate
    console.log(`2. Navigating to ${TARGET_URL}...`);
    await navigate(client, TARGET_URL);
    console.log('[OK] Navigation complete\n');

    // 3. ARIA snapshot and basic validation
    console.log('3. Requesting ARIA snapshot...');
    const ariaTree = await snapshot(client);
    if (!ariaTree || ariaTree.length === 0) {
      throw new Error('[ERROR] ARIA snapshot returned empty');
    }
    const hasHeading = /heading/i.test(ariaTree);
    if (!hasHeading) {
      throw new Error('[ERROR] ARIA snapshot does not contain a heading...)');
    }
    console.log('[OK] ARIA snapshot received and contains heading');
    console.log(`   Preview: ${ariaTree.slice(0, 200).replace(/\n/g, ' ')}\n`);

    // 4. Evaluate
    console.log('4. Evaluating JavaScript in page context...');
    const title = await evaluate(client, '() => document.title');
    if (!title) {
      throw new Error('[ERROR] evaluate() returned empty string');
    }
    console.log(`[OK] document.title = "${title}"\n`);

    // 5. Screenshot
    console.log('5. Taking screenshot...');
    const img = await screenshot(client);
    if (!img || !img.data || img.data.length === 0) {
      throw new Error('[ERROR] Screenshot returned no image data');
    }
    console.log(`[OK] Screenshot received (${img.mimeType}, ${Math.round(img.data.length * 0.75 / 1024)} KB)\n`);

    // 6. Key press
    console.log('6. Pressing Tab key...');
    await pressKey(client, 'Tab');
    console.log('[OK] Tab key pressed without error\n');

    // Summary
    console.log('--- All checks passed. MCP layer is working :D ---');

  } finally {
    await closeBrowser(client);
    await client.close();
  }
}

runSmokeTest().catch((err: unknown) => {
  console.error('\n[ERROR] Smoke test FAILED:', err);
  process.exit(1);
});
