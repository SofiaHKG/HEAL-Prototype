import 'dotenv/config';
import { runSC212Assessment } from '../orchestrator/sc212orchestrator';
import { runSingleSC } from './runSingleSC';

runSingleSC('2.1.2', 'No Keyboard Trap', runSC212Assessment, process.argv.slice(2)).catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
