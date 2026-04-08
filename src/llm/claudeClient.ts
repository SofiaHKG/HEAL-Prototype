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
  // Optional screenshot for multimodal assessments (e.g. SC 1.1.1)
  imageBase64?: string;
  imageMimeType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

// Send a single-turn assessment request to Claude...
// If imageBase64 is provided the user turn is sent as a multimodal content
// array (text + image), otherwise it is sent as a plain text string
export async function assess(params: AssessParams): Promise<string> {
  type UserContent =
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      >;

  let userContent: UserContent;

  if (params.imageBase64 !== undefined && params.imageBase64 !== '') {
    userContent = [
      { type: 'text', text: params.userMessage },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: params.imageMimeType ?? 'image/png',
          data: params.imageBase64,
        },
      },
    ];
  } else {
    userContent = params.userMessage;
  }

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: params.systemPrompt,
    messages: [{ role: 'user', content: userContent as any }],
  });

  for (const block of response.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }

  throw new Error('claudeClient.assess: no text block in Claude response');
}