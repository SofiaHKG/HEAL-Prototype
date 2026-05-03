import type { SampleMode } from '../orchestrator/sampling';

export type EvalCliArgs = {
  url: string;
  outPath?: string;
  mode: SampleMode;
  trace: boolean;
};

const URL_PATTERN = /^https?:\/\//i;
const QUERY_FRAGMENT_PATTERN = /^[A-Za-z_][\w.-]*=.+/;
const MODE_FLAGS: Record<string, SampleMode> = {
  '--full': 'full',
  '--partial': 'partial',
};

const TRACE_FLAGS: Record<string, boolean> = {
  '--trace=on': true,
  '--trace=off': false,
};

const DEFAULT_MODE: SampleMode = 'full';

export function parseEvalCliArgs(args: string[], usageCommand: string): EvalCliArgs {
  // First pass: pull out the sampling-mode flag so it can appear in any position.
  let mode: SampleMode = DEFAULT_MODE;
  let trace = false;
  const positional: string[] = [];
  for (const token of args) {
    if (token && Object.prototype.hasOwnProperty.call(MODE_FLAGS, token)) {
      mode = MODE_FLAGS[token] as SampleMode;
      continue;
    }
    if (token && Object.prototype.hasOwnProperty.call(TRACE_FLAGS, token)) {
      trace = TRACE_FLAGS[token] as boolean;
      continue;
    }
    if (token) positional.push(token);
  }

  let url = positional[0];
  if (!url || !URL_PATTERN.test(url)) {
    console.error(`Correct usage: ${usageCommand} -- <url> [out-path] [--full|--partial] [--trace=on|--trace=off]`);
    console.error(`Example: ${usageCommand} -- https://...`);
    console.error(`Modes:`);
    console.error(`  --full     evaluate every collected item (default, slowest)`);
    console.error(`  --partial  evaluate the first 30 items per SC`);
    console.error(`Tracing:`);
    console.error(`  --trace=on   capture Playwright trace.zip for the axe/browser session`);
    console.error(`  --trace=off  do not capture trace (default)`);
    process.exit(1);
  }

  let outPath: string | undefined;
  for (let i = 1; i < positional.length; i++) {
    const token = positional[i];
    if (token && QUERY_FRAGMENT_PATTERN.test(token)) {
      url += (url.includes('?') ? '&' : '?') + token;
      continue;
    }

    outPath = token;
    break;
  }

  return outPath === undefined ? { url, mode, trace } : { url, outPath, mode, trace };
}