import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';
import { createMcpClient } from '../mcp/client';
import { navigate } from '../mcp/tools';
import { collectSC111Evidence } from '../evidence/sc111';
import { assess } from '../llm/claudeClient';
import { parseAssessment } from '../llm/parser';
import { buildSC111AssessParams } from '../llm/prompts/sc111prompt';

// Result shape
export interface SC111Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}

// Orchestrator function to run the whole SC 1.1.1 assessment flow for a given URL
export async function runSC111Assessment(url: string): Promise<SC111Result[]> {
  const client = await createMcpClient();

  try {
    await navigate(client, url);

    const bundles = await collectSC111Evidence(client);

    if (bundles.length === 0) {
      return [];
    }

    const results: SC111Result[] = [];

    for (const bundle of bundles) {
      // buildSC111AssessParams returns the full AssessParams (incl. optional image)
      const assessParams = buildSC111AssessParams(bundle);
      const rawReply = await assess(assessParams);
      const assessment = parseAssessment(rawReply);
      results.push({ bundle, assessment });
    }

    return results; // One result per image/role=img/input[type=image] element found
  } finally {
    await client.close();
  }
}
