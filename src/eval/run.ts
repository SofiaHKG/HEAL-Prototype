import 'dotenv/config';
import { chromium } from '@playwright/test';
import { runAxe, getAxeFindingsForSC, SC_RULE_MAP } from '../axe/axeRunner';
import type { AxeNodeFinding } from '../axe/axeRunner';
import { parseEvalCliArgs } from './cliArgs';
import { buildAggregateReport, printSummary, writeReport, type SCResult } from '../output/reporter';
import { runSC111Assessment } from '../orchestrator/sc111orchestrator';
import { runSC212Assessment } from '../orchestrator/sc212orchestrator';
import { runSC244Assessment } from '../orchestrator/sc244orchestrator';
import { runSC312Assessment } from '../orchestrator/sc312orchstrator';

async function main(): Promise<void> {
  const { url, outPath: providedOutPath } = parseEvalCliArgs(process.argv.slice(2), 'npm run eval');

  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-full-' + timestamp + '.json';
  const outPath = providedOutPath ?? defaultOut;

  console.log('HEAL - Full Aggregate Assessment');
  console.log('URL:    ' + url);
  console.log('Output: ' + outPath);
  console.log('');

  // Layer 1: axe-core (rule-based)
  console.log('[1/5] Running axe-core scan...');
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

  // Layer 2: LLM assessment per SC
  const allResults: SCResult[] = [];

  console.log('[2/5] SC 1.1.1 Non-text Content...');
  const sc111 = await runSC111Assessment(url);
  allResults.push(...sc111);
  console.log('  ' + sc111.length + ' element(s) assessed\n');

  console.log('[3/5] SC 2.1.2 No Keyboard Trap...');
  const sc212 = await runSC212Assessment(url);
  allResults.push(...sc212);
  console.log('  ' + sc212.length + ' assessment(s)\n');

  console.log('[4/5] SC 2.4.4 Link Purpose...');
  const sc244 = await runSC244Assessment(url);
  allResults.push(...sc244);
  console.log('  ' + sc244.length + ' link(s) assessed\n');

  console.log('[5/5] SC 3.1.2 Language of Parts...');
  const sc312 = await runSC312Assessment(url);
  allResults.push(...sc312);
  console.log('  ' + sc312.length + ' element(s) assessed\n');

  // Build & write report
  const report = buildAggregateReport(url, axeGroups, allResults);
  printSummary(report);
  await writeReport(report, outPath);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});