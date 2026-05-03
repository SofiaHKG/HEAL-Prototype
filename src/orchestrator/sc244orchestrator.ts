import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { EvidenceBundle, SC244Evidence, SC244EscalationResult } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigateAndSettle } from '../mcp/tools';
import { collectSC244Evidence } from '../evidence/sc244';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC244_SYSTEM_PROMPT, buildSC244UserMessage } from '../llm/prompts/sc244prompt';
import { escalateSC244Finding } from '../llm/escalation/sc244escalation';
import { sampleItems, describeSampleMode, type SampleMode } from './sampling';

// Result shape
export interface SC244Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
  escalation?: SC244EscalationResult;
}

export async function runSC244AssessmentOnClient(
  client: Client,
  mode: SampleMode = 'full',
): Promise<SC244Result[]> {
  const allBundles = await collectSC244Evidence(client);
  if (allBundles.length === 0) return [];

  const bundles = sampleItems(allBundles, mode);
  if (bundles.length !== allBundles.length) {
    console.log('  SC 2.4.4: ' + describeSampleMode(mode, allBundles.length, bundles.length));
  }

  const results: SC244Result[] = [];
  for (const bundle of bundles) {
    const userMessage = buildSC244UserMessage(bundle);
    const rawReply = await assess({ systemPrompt: SC244_SYSTEM_PROMPT, userMessage });
    const assessment = parseAssessment(rawReply);

    const shouldEscalate =
      assessment.verdict === 'needs_review' ||
      (assessment.verdict === 'fail' && assessment.confidence !== 'high');

    if (!shouldEscalate) {
      results.push({ bundle, assessment });
      continue;
    }

    const evidence = bundle.evidence as unknown as SC244Evidence;

    try {
      const escalation = await escalateSC244Finding(
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

export async function runSC244Assessment(url: string, mode: SampleMode = 'full'): Promise<SC244Result[]> {
  const client = await createMcpClient();
  try {
    await navigateAndSettle(client, url);
    return await runSC244AssessmentOnClient(client, mode);
  } finally {
    await client.close();
  }
}
