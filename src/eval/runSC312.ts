import 'dotenv/config';
import { parseEvalCliArgs } from './cliArgs';
import { runSC312Assessment } from '../orchestrator/sc312orchstrator';
import { buildReport, writeReport, printSummary } from '../output/reporter';

async function main(): Promise<void> {
  const { url, outPath: providedOutPath } = parseEvalCliArgs(process.argv.slice(2), 'npm run eval:sc312');

  // Default output path: reports/<hostname>-sc312-<timestamp>.json
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-sc312-' + timestamp + '.json';
  const outPath = providedOutPath ?? defaultOut;

  console.log('HEAL - SC 3.1.2 Language of Parts');
  console.log('URL:    ' + url);
  console.log('Output: ' + outPath);
  console.log('Running assessment...\n');

  const results = await runSC312Assessment(url);
  const report = buildReport(url, results);

  printSummary(report);
  await writeReport(report, outPath);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});