import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigateAndSettle } from '../mcp/tools';
import { collectSC312Evidence } from '../evidence/sc312';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC312_SYSTEM_PROMPT, buildSC312UserMessage } from '../llm/prompts/sc312prompt';
import { sampleItems, describeSampleMode, type SampleMode } from './sampling';

// Result shape
export interface SC312Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}

export async function runSC312AssessmentOnClient(
  client: Client,
  mode: SampleMode = 'full',
): Promise<SC312Result[]> {
  const allBundles = await collectSC312Evidence(client);
  if (allBundles.length === 0) return [];

  const bundles = sampleItems(allBundles, mode);
  if (bundles.length !== allBundles.length) {
    console.log('  SC 3.1.2: ' + describeSampleMode(mode, allBundles.length, bundles.length));
  }

  const results: SC312Result[] = [];
  for (const bundle of bundles) {
    const userMessage = buildSC312UserMessage(bundle);
    const rawReply = await assess({ systemPrompt: SC312_SYSTEM_PROMPT, userMessage });
    const assessment = parseAssessment(rawReply);
    results.push({ bundle, assessment });
  }
  return results;
}

export async function runSC312Assessment(url: string, mode: SampleMode = 'full'): Promise<SC312Result[]> {
  const client = await createMcpClient();
  try {
    await navigateAndSettle(client, url);
    return await runSC312AssessmentOnClient(client, mode);
  } finally {
    await client.close();
  }
}
