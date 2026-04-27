import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';  // via ANTHROPIC_API_KEY env var
const MAX_TOKENS = 512; // JSON is small...
const TEMPERATURE = 0;  // Deterministic, reproducible output

// Retry config for transient API errors (429 rate-limit, 5xx incl. 529 overloaded)
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: params.systemPrompt,
    messages: [
      { role: 'user', content: userContent as any },
      { role: 'assistant', content: '{' },
    ],
  } as const;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().messages.create(requestBody as any);

      for (const block of response.content) {
        if (block.type === 'text') {
          // The assistant prefill msg contains '{', so it will force Claude to continue conmpleting the JSON object (fixing bug where it instead starts with prose)
          return '{' + block.text;
        }
      }

      throw new Error('claudeClient.assess: no text block in Claude response');
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number } | null)?.status;
      if (attempt === MAX_RETRIES || !isRetryableStatus(status)) {
        throw err;
      }

      const retryAfterHeader =
        (err as { headers?: { get?: (k: string) => string | null } } | null)?.headers?.get?.(
          'retry-after',
        ) ?? null;
      const retryAfterMs = retryAfterHeader
        ? Math.max(0, Number(retryAfterHeader) * 1000)
        : NaN;

      const expBackoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * 500);
      const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs + jitter
        : expBackoff + jitter;

      console.warn(
        `  [claude] ${status ?? '???'} ${(err as Error).message?.slice(0, 80) ?? ''} - ` +
          `retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
    }
  }

  throw lastErr;
}