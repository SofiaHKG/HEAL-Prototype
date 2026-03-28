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