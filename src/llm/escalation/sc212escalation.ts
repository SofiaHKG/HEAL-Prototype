import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SC212Evidence, SC212EscalationResult, EscalationToolCall } from '../../types/finding';

const MODEL = 'claude-haiku-4-5';
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 1024;
const TEMPERATURE = 0;

// Tool schemas (Anthropic format)

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'finalize',
    description:
      'Submit the final verdict. Call exactly once when investigation is complete.',
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail', 'needs_review'] },
        rationale: { type: 'string' },
        uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
        trapLocation: { type: 'string' },
        escapeAttempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              movedFocus: { type: 'boolean' },
              newSelector: { type: 'string' },
            },
            required: ['key', 'movedFocus'],
          },
        },
        rootCause: { type: 'string' },
        suggestedFix: { type: 'string' },
      },
      required: ['verdict', 'rationale', 'uncertainty', 'rootCause', 'suggestedFix'],
    },
  },
];

// System prompt

const SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility investigator. The deterministic
SC 2.1.2 detector flagged a potential keyboard trap.

Your job is to review the provided deterministic evidence and produce a
concise, developer-actionable verdict.

SC 2.1.2 No Keyboard Trap means: if keyboard focus can be moved to a component
using a keyboard interface, focus must also be movable away from that component
using only a keyboard interface.

Decide one of:
- pass: the evidence shows there is a keyboard mechanism to leave the component.
- fail: the evidence shows keyboard focus is trapped and no keyboard exit exists.
- needs_review: the evidence is insufficient or ambiguous.

Respond ONLY by calling finalize.`;

// Helpers

function buildKickoffMessage(stuckSelector: string | null, ev: SC212Evidence): string {
  return (
    'A potential SC 2.1.2 keyboard trap was detected on this page.\n\n' +
    'Deterministic evidence summary:\n' +
    '- stuckSelector: ' + (stuckSelector ?? '(none)') + '\n' +
    '- trapDetected: ' + ev.trapDetected + '\n' +
    '- trapType: ' + (ev.trapType ?? '(none)') + '\n' +
    '- escapeBehavior: ' + ev.escapeBehavior + '\n' +
    '- shiftTabBehavior: ' + ev.shiftTabBehavior + '\n' +
    '- totalTabsPressed: ' + ev.totalTabsPressed + '\n' +
    '- uniqueSelectorsCount: ' + ev.uniqueSelectorsCount + '\n' +
    '- totalPageFocusable: ' + ev.totalPageFocusable + '\n\n' +
    'Call finalize with the best verdict based on this evidence.'
  );
}

function buildFallback(
  reason: string,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC212EscalationResult {
  return {
    verdict: 'needs_review',
    rationale: 'Escalation incomplete: ' + reason,
    uncertainty: 'high',
    trapLocation: null,
    escapeAttempts: [],
    occlusion: null,
    rootCause: 'unknown — escalation did not finalize',
    suggestedFix: 'Manual review required',
    toolCallCount,
    transcript,
  };
}

function parseFinalizeInput(
  input: Record<string, unknown>,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC212EscalationResult {
  const verdict = (input['verdict'] as SC212EscalationResult['verdict']) ?? 'needs_review';
  const uncertainty =
    (input['uncertainty'] as SC212EscalationResult['uncertainty']) ?? 'medium';

  const attemptsIn = Array.isArray(input['escapeAttempts'])
    ? (input['escapeAttempts'] as Array<Record<string, unknown>>)
    : [];
  const escapeAttempts = attemptsIn.map(a => ({
    key: String(a['key'] ?? ''),
    movedFocus: Boolean(a['movedFocus']),
    newSelector:
      typeof a['newSelector'] === 'string' ? (a['newSelector'] as string) : null,
  }));

  return {
    verdict,
    rationale: String(input['rationale'] ?? ''),
    uncertainty,
    trapLocation:
      typeof input['trapLocation'] === 'string'
        ? (input['trapLocation'] as string)
        : null,
    escapeAttempts,
    occlusion: null,
    rootCause: String(input['rootCause'] ?? ''),
    suggestedFix: String(input['suggestedFix'] ?? ''),
    toolCallCount,
    transcript,
  };
}

// Main entry point

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function escalateSC212Finding(
  mcp: Client,
  evidence: SC212Evidence,
  stuckSelector: string | null,
): Promise<SC212EscalationResult> {
  void mcp;

  const transcript: EscalationToolCall[] = [];
  const toolCallCount = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildKickoffMessage(stuckSelector, evidence) },
  ];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      return buildFallback(
        'model returned text without calling finalize',
        transcript,
        toolCallCount,
      );
    }

    const finalizeCall = toolUses.find(t => t.name === 'finalize');
    if (finalizeCall) {
      return parseFinalizeInput(
        finalizeCall.input as Record<string, unknown>,
        transcript,
        toolCallCount,
      );
    }
  }

  return buildFallback(
    'max iterations (' + MAX_ITERATIONS + ') reached without finalize',
    transcript,
    toolCallCount,
  );
}