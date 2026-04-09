import 'dotenv/config';
import { runSC111Assessment } from '../orchestrator/sc111orchestrator';
import { buildReport, writeReport, printSummary } from '../output/reporter';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const url = args[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    console.error('Correct usage: npm run eval:sc111 -- <url> [out-path]');
    console.error('Example: npm run eval:sc111 -- https://...');
    process.exit(1);
  }

  // Default output path: reports/<hostname>-sc111-<timestamp>.json
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = 'reports/' + hostname + '-sc111-' + timestamp + '.json';
  const outPath = args[1] ?? defaultOut;

  console.log('HEAL - SC 1.1.1 Non-text Content');
  console.log('URL:    ' + url);
  console.log('Output: ' + outPath);
  console.log('Running assessment...\n');

  const results = await runSC111Assessment(url);
  const report = buildReport(url, results);

  printSummary(report);
  await writeReport(report, outPath);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
