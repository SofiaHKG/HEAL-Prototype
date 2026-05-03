import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { EvidenceBundle, SC212Evidence, SC212EscalationResult } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigateAndSettle } from '../mcp/tools';
import { collectSC212Evidence } from '../evidence/sc212';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC212_SYSTEM_PROMPT, buildSC212UserMessage } from '../llm/prompts/sc212prompt';
import { escalateSC212Finding } from '../llm/escalation/sc212escalation';
import { sampleItems, describeSampleMode, type SampleMode } from './sampling';

// Result shape
export interface SC212Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
  escalation?: SC212EscalationResult;
}

export async function runSC212AssessmentOnClient(
  client: Client,
  mode: SampleMode = 'full',
): Promise<SC212Result[]> {
  const allBundles = await collectSC212Evidence(client);
  if (allBundles.length === 0) return [];

  const bundles = sampleItems(allBundles, mode);
  if (bundles.length !== allBundles.length) {
    console.log('  SC 2.1.2: ' + describeSampleMode(mode, allBundles.length, bundles.length));
  }

  const results: SC212Result[] = [];
  for (const bundle of bundles) {
    const userMessage = buildSC212UserMessage(bundle);
    const rawReply = await assess({ systemPrompt: SC212_SYSTEM_PROMPT, userMessage });
    const assessment = parseAssessment(rawReply);

    const shouldEscalate =
      assessment.verdict === 'needs_review' ||
      (assessment.verdict === 'fail' && assessment.confidence !== 'high');

    if (!shouldEscalate) {
      results.push({ bundle, assessment });
      continue;
    }

    const evidence = bundle.evidence as unknown as SC212Evidence;

    try {
      const escalation = await escalateSC212Finding(
        client,
        evidence,
        bundle.element.selector,
      );

      results.push({
        bundle,
        assessment: {
          verdict: escalation.verdict,
          rationale: escalation.rationale,
          confidence: escalation.confidence,
        },
        escalation,
      });
    } catch {
      results.push({ bundle, assessment });
    }
  }
  return results;
}

export async function runSC212Assessment(url: string, mode: SampleMode = 'full'): Promise<SC212Result[]> {
  const client = await createMcpClient();
  try {
    await navigateAndSettle(client, url);
    return await runSC212AssessmentOnClient(client, mode);
  } finally {
    await client.close();
  }
}
