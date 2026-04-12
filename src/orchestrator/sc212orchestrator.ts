import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigate } from '../mcp/tools';
import { collectSC212Evidence } from '../evidence/sc212';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC212_SYSTEM_PROMPT, buildSC212UserMessage } from '../llm/prompts/sc212prompt';

// Result shape
export interface SC212Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}

// Orchestrator: run the full SC 2.1.2 assessment for a given URL
export async function runSC212Assessment(url: string): Promise<SC212Result[]> {
  const client = await createMcpClient();

  try {
    await navigate(client, url);

    const bundles = await collectSC212Evidence(client);

    if (bundles.length === 0) {
      return [];
    }

    const results: SC212Result[] = [];

    for (const bundle of bundles) {
      const userMessage = buildSC212UserMessage(bundle);
      const rawReply = await assess({ systemPrompt: SC212_SYSTEM_PROMPT, userMessage });
      const assessment = parseAssessment(rawReply);
      results.push({ bundle, assessment });
    }

    return results;   // Typically one result (page-level trap assessment)
  } finally {
    await client.close();
  }
}