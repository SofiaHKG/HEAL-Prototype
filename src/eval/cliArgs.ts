export type EvalCliArgs = {
  url: string;
  outPath?: string;
};

const URL_PATTERN = /^https?:\/\//i;
const QUERY_FRAGMENT_PATTERN = /^[A-Za-z_][\w.-]*=.+/;

export function parseEvalCliArgs(args: string[], usageCommand: string): EvalCliArgs {
  let url = args[0];
  if (!url || !URL_PATTERN.test(url)) {
    console.error(`Correct usage: ${usageCommand} -- <url> [out-path]`);
    console.error(`Example: ${usageCommand} -- https://...`);
    process.exit(1);
  }

  let outPath: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token && QUERY_FRAGMENT_PATTERN.test(token)) {
      url += (url.includes('?') ? '&' : '?') + token;
      continue;
    }

    outPath = token;
    break;
  }

  return outPath === undefined ? { url } : { url, outPath };
}