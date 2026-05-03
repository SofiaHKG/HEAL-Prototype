import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';
import { chromium } from '@playwright/test';
import { runAxe, getAxeFindingsForSC, SC_RULE_MAP } from '../axe/axeRunner';
import type { AxeNodeFinding } from '../axe/axeRunner';
import { parseEvalCliArgs } from './cliArgs';
import { buildAggregateReport, printSummary, writeReport, type SCResult } from '../output/reporter';
import { saveHealHtmlReport } from '../output/htmlReporter';
import { createMcpClient } from '../mcp/client';
import { navigateAndSettle } from '../mcp/tools';
import { runSC111AssessmentOnClient } from '../orchestrator/sc111orchestrator';
import { runSC212AssessmentOnClient } from '../orchestrator/sc212orchestrator';
import { runSC244AssessmentOnClient } from '../orchestrator/sc244orchestrator';
import { runSC312AssessmentOnClient } from '../orchestrator/sc312orchestrator';

async function main(): Promise<void> {
  const { url, outPath: providedOutPath, mode, trace } = parseEvalCliArgs(process.argv.slice(2), 'npm run eval');

  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-' + mode + '-' + timestamp + '.json';
  const outPath = providedOutPath ?? defaultOut;

  // MCP writes traces under <output-dir>/traces
  const traceDir = path.resolve(outPath.replace(/\.json$/i, '') + '-mcp-trace');

  console.log('HEAL - Full Aggregate Assessment');
  console.log('URL:    ' + url);
  console.log('Mode:   ' + mode + (mode === 'full' ? '' : ' (cap 30/SC)'));
  console.log('Trace:  ' + (trace ? 'on (HEAL/MCP run)' : 'off'));
  console.log('Output: ' + outPath);
  console.log('');

  const formatDuration = (ms: number): string => {
    const roundedSec = Math.round(ms / 1000);
    const min = Math.floor(roundedSec / 60);
    const sec = roundedSec % 60;
    return min > 0 ? min + 'm ' + sec + 's' : sec + 's';
  };

  const overallStart = Date.now();

  // Layer 1: axe-core (rule-based) - no tracing here; trace covers the HEAL/MCP run only
  console.log('[1/5] Running axe-core scan...');
  const axeStart = Date.now();
  const axeGroups: { sc: string; findings: AxeNodeFinding[] }[] = [];
  {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      try {
        await page.waitForLoadState('networkidle', { timeout: 10_000 });
      } catch {
        // Page kept the network busy -> proceed anyway
      }
      const axeResults = await runAxe(page);

      // Skip SCs whose rule list is empty (e.g. 2.1.2 - axe has no rules for it)
      for (const [sc, ruleIds] of Object.entries(SC_RULE_MAP)) {
        if (ruleIds.length === 0) continue;
        axeGroups.push({ sc, findings: getAxeFindingsForSC(axeResults, sc) });
      }

      const totalAxe = axeGroups.reduce((n, g) => n + g.findings.length, 0);
      console.log('  axe-core: ' + totalAxe + ' finding(s) (' + formatDuration(Date.now() - axeStart) + ')\n');
    } finally {
      await browser.close();
    }
  }

  // Layer 2: LLM assessment per SC -> share a single MCP client + one navigation
  // across all four SCs. Sequence is chosen so SCs that benefit from a clean
  // page (no cookie/consent banner) run after SC 2.1.2 has potentially
  // dismissed it:
  //   1) 2.1.2 - keyboard-trap probe may dismiss modal/banner via Escape/Tab
  //   2) 1.1.1 - image assessment benefits from banner being gone
  //   3) 2.4.4 - link inventory is cleaner without privacy/legal links
  //   4) 3.1.2 - language-of-parts is cleaner without localized banner text
  const allResults: SCResult[] = [];
  const mcp = await createMcpClient(
    trace ? { caps: 'devtools', outputDir: traceDir } : {},
  );
  let tracingStarted = false;
  try {
    await navigateAndSettle(mcp, url);

    if (trace) {
      await mcp.callTool({ name: 'browser_start_tracing', arguments: {} });
      tracingStarted = true;
    }

    console.log('[2/5] SC 2.1.2 No Keyboard Trap...');
    const sc212Start = Date.now();
    const sc212 = await runSC212AssessmentOnClient(mcp, mode);
    allResults.push(...sc212);
    console.log('  ' + sc212.length + ' assessment(s) (' + formatDuration(Date.now() - sc212Start) + ')\n');

    console.log('[3/5] SC 1.1.1 Non-text Content...');
    const sc111Start = Date.now();
    const sc111 = await runSC111AssessmentOnClient(mcp, url, mode);
    allResults.push(...sc111);
    console.log('  ' + sc111.length + ' element(s) assessed (' + formatDuration(Date.now() - sc111Start) + ')\n');

    console.log('[4/5] SC 2.4.4 Link Purpose...');
    const sc244Start = Date.now();
    const sc244 = await runSC244AssessmentOnClient(mcp, mode);
    allResults.push(...sc244);
    console.log('  ' + sc244.length + ' link(s) assessed (' + formatDuration(Date.now() - sc244Start) + ')\n');

    console.log('[5/5] SC 3.1.2 Language of Parts...');
    const sc312Start = Date.now();
    const sc312 = await runSC312AssessmentOnClient(mcp, mode);
    allResults.push(...sc312);
    console.log('  ' + sc312.length + ' element(s) assessed (' + formatDuration(Date.now() - sc312Start) + ')\n');
  } finally {
    if (tracingStarted) {
      try {
        await mcp.callTool({ name: 'browser_stop_tracing', arguments: {} });
        // trace zips can be opended with "npx playwright show-trace" or at trace.playwright.dev
        const tracesFolder = path.join(traceDir, 'traces');
        const zipPath = traceDir + '.zip';
        await zipDirectoryContents(tracesFolder, zipPath);
        await fs.promises.rm(traceDir, { recursive: true, force: true });
        console.log('  Trace saved to: ' + zipPath + '\n');
      } catch (err) {
        console.warn('  Warning: failed to stop/package MCP tracing:', err);
      }
    }
    await mcp.close();
  }

  console.log('Total scan time: ' + formatDuration(Date.now() - overallStart));

  // Build & write report
  const report = buildAggregateReport(url, axeGroups, allResults);
  printSummary(report);
  await writeReport(report, outPath);
  const htmlOutPath = outPath.replace(/\.json$/i, '.html');
  await saveHealHtmlReport(report, htmlOutPath === outPath ? outPath + '.html' : htmlOutPath);
}

function zipDirectoryContents(sourceDir: string, outZipPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    // Placing the directorys contents at the zip root (not the dir itself)
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});