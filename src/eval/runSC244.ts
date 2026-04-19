import 'dotenv/config';
import { parseEvalCliArgs } from './cliArgs';
import { runSC244Assessment } from '../orchestrator/sc244orchestrator';
import { buildReport, writeReport, printSummary } from '../output/reporter';

async function main(): Promise<void> {
  const { url, outPath: providedOutPath } = parseEvalCliArgs(process.argv.slice(2), 'npm run eval:sc244');

  // Default output path: reports/<hostname>-sc244-<timestamp>.json
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-sc244-' + timestamp + '.json';
  const outPath = providedOutPath ?? defaultOut;

  console.log('HEAL - SC 2.4.4 Link Purpose (In Context)');
  console.log('URL:    ' + url);
  console.log('Output: ' + outPath);
  console.log('Running assessment...\n');

  const results = await runSC244Assessment(url);
  const report = buildReport(url, results);

  printSummary(report);
  await writeReport(report, outPath);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});