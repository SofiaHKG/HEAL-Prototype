import 'dotenv/config';
import { runSC244Assessment } from '../orchestrator/sc244orchestrator';
import { runSingleSC } from './runSingleSC';

runSingleSC('2.4.4', 'Link Purpose (In Context)', runSC244Assessment, process.argv.slice(2)).catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
