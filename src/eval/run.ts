import 'dotenv/config';
import { chromium } from '@playwright/test';
import { runAxe, getAxeFindingsForSC, SC_RULE_MAP } from '../axe/axeRunner';
import type { AxeNodeFinding } from '../axe/axeRunner';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const url = args[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    console.error('Correct usage: npm run eval -- <url> [out-path]');
    console.error('Example: npm run eval -- https://...');
    process.exit(1);
  }

  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-full-' + timestamp + '.json';
  const outPath = args[1] ?? defaultOut;

  console.log('HEAL - Full Aggregate Assessment');
  console.log('URL:    ' + url);
  console.log('Output: ' + outPath);
  console.log('');

  // Layer 1: axe-core (rule-based)
  console.log('Running axe-core scan...');
  const axeGroups: { sc: string; findings: AxeNodeFinding[] }[] = [];
  {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const axeResults = await runAxe(page);

      for (const sc of Object.keys(SC_RULE_MAP)) {
        const findings = getAxeFindingsForSC(axeResults, sc);
        axeGroups.push({ sc, findings });
      }

      const totalAxe = axeGroups.reduce((n, g) => n + g.findings.length, 0);
      console.log('  axe-core: ' + totalAxe + ' finding(s)\n');
    } finally {
      await browser.close();
    }
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
