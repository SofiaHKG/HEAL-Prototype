import 'dotenv/config';
import { runSC111Assessment } from '../orchestrator/sc111orchestrator';
import { runSingleSC } from './runSingleSC';

runSingleSC('1.1.1', 'Non-text Content', runSC111Assessment, process.argv.slice(2)).catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
