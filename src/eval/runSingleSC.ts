import { parseEvalCliArgs } from './cliArgs';
import { buildReport, writeReport, printSummary, type SCResult } from '../output/reporter';
import type { SampleMode } from '../orchestrator/sampling';

/**
 * Shared entry point for the per-SC CLIs (runSC111, runSC212, ...)
 * Handles argument parsing, default output path, banner, report build/write
 */
export async function runSingleSC(
  scId: string,
  scTitle: string,
  assess: (url: string, mode: SampleMode) => Promise<SCResult[]>,
  argv: string[],
): Promise<void> {
  const slug = 'sc' + scId.replace(/\./g, '');
  const { url, outPath: providedOutPath, mode } = parseEvalCliArgs(argv, 'npm run eval:' + slug);

  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-' + slug + '-' + timestamp + '.json';
  const outPath = providedOutPath ?? defaultOut;

  console.log('HEAL - SC ' + scId + ' ' + scTitle);
  console.log('URL:    ' + url);
  console.log('Mode:   ' + mode + (mode === 'full' ? '' : ' (cap 30)'));
  console.log('Output: ' + outPath);
  console.log('Running assessment...\n');

  const results = await assess(url, mode);
  const report = buildReport(url, results);

  printSummary(report);
  await writeReport(report, outPath);
}
