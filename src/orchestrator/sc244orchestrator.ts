import type { EvidenceBundle, SC244Evidence } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigate } from '../mcp/tools';
import { collectSC244Evidence } from '../evidence/sc244';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC244_SYSTEM_PROMPT, buildSC244UserMessage } from '../llm/prompts/sc244prompt';
import { escalateSC244Finding } from '../llm/escalation/sc244escalation';
import type { SC244EscalationResult } from '../types/finding';

// Result shape
export interface SC244Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
  escalation?: SC244EscalationResult;
}

// Orchestrator function to run the whole SC 2.4.4 assessment flow for a given URL
export async function runSC244Assessment(url: string): Promise<SC244Result[]> {
  const client = await createMcpClient();

  try {
    await navigate(client, url);

    const bundles = await collectSC244Evidence(client);

    if (bundles.length === 0) {
      return [];
    }

    const results: SC244Result[] = [];

    for (const bundle of bundles) {
      const userMessage = buildSC244UserMessage(bundle);
      const rawReply = await assess({ systemPrompt: SC244_SYSTEM_PROMPT, userMessage });
      const assessment = parseAssessment(rawReply);

      const shouldEscalate =
        assessment.verdict === 'needs_review' ||
        (assessment.verdict === 'fail' && assessment.uncertainty !== 'low');

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
            uncertainty: escalation.uncertainty,
          },
          escalation,
        });
      } catch {
        results.push({ bundle, assessment });
      }
    }

    return results;   // One result per link/area element found
  } finally {
    await client.close();
  }
}