import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';  // via ANTHROPIC_API_KEY env var
const MAX_TOKENS = 512; // JSON is small...
const TEMPERATURE = 0;  // Deterministic, reproducible output

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export interface AssessParams {
  systemPrompt: string;
  userMessage: string;
}

// Send a single-turn assessment request to Claude
export async function assess(params: AssessParams): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: params.systemPrompt,
    messages: [
      { role: 'user', content: params.userMessage },
    ],
  });

  for (const block of response.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }

  throw new Error('claudeClient.assess: no text block in Claude response');
}