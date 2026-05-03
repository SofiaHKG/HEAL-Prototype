import 'dotenv/config';
import { runSC312Assessment } from '../orchestrator/sc312orchestrator';
import { runSingleSC } from './runSingleSC';

runSingleSC('3.1.2', 'Language of Parts', runSC312Assessment, process.argv.slice(2)).catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
