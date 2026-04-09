import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigate } from '../mcp/tools';
import { collectSC312Evidence } from '../evidence/sc312';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { SC312_SYSTEM_PROMPT, buildSC312UserMessage } from '../llm/prompts/sc312prompt';

// Result shape
export interface SC312Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}

// Orchestrator function to run the whole SC 3.1.2 assessment flow for a given URL
export async function runSC312Assessment(url: string): Promise<SC312Result[]> {
  const client = await createMcpClient();

  try {
    await navigate(client, url);

    const bundles = await collectSC312Evidence(client);

    if (bundles.length === 0) {
      return [];
    }

    const results: SC312Result[] = [];

    for (const bundle of bundles) {
      const userMessage = buildSC312UserMessage(bundle);
      const rawReply = await assess({ systemPrompt: SC312_SYSTEM_PROMPT, userMessage });
      const assessment = parseAssessment(rawReply);
      results.push({ bundle, assessment });
    }

    return results;   // One result per lang-annotated element found
  } finally {
    await client.close();
  }
}