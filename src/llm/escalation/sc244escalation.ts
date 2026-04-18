import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_CALLS = 10;
const MAX_ITERATIONS = 12;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'inspect_link_context',
    description:
      'Inspect the target link and its contextual container. Returns accessible ' +
      'name, href, role, surrounding text, and nearest heading/label clues.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        href: { type: 'string' },
        accessibleName: { type: 'string' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'inspect_element',
    description:
      'Inspect any element by selector to gather role, labels, text, and child headings.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'screenshot_element',
    description:
      'Capture the visual context of an element as PNG to resolve ambiguous link purpose.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'finalize',
    description:
      'Submit the final enriched SC 2.4.4 verdict. Call exactly once after investigation.',
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail', 'needs_review'] },
        rationale: { type: 'string' },
        uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
        resolvedPurpose: { type: 'string' },
        contextContainer: { type: 'string' },
        rootCause: { type: 'string' },
        suggestedFix: { type: 'string' },
      },
      required: ['verdict', 'rationale', 'uncertainty', 'rootCause', 'suggestedFix'],
    },
  },
];

const SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility investigator for SC 2.4.4 Link Purpose (In Context).

The deterministic pass flagged a potentially ambiguous link. Investigate the live page and produce
an enriched, developer-actionable verdict.

Core rule:
- PASS when link purpose is clear from accessible name alone OR from accessible name plus programmatically
  determinable context (section heading, card title, list item label, table header, nearby descriptive text).
- FAIL when purpose is still ambiguous even after context inspection.
- NEEDS_REVIEW when evidence remains mixed/insufficient.

Investigation workflow:
1. Call inspect_link_context on the target link.
2. If needed, inspect parent/ancestor containers or related heading elements.
3. Capture one screenshot (target link or context container) when visual grouping is relevant.
4. Call finalize.

Constraints:
- Do not navigate/reload/click links.
- Do not rely on URL slug alone to infer purpose.
- Keep tool usage concise; budget is ${MAX_TOOL_CALLS} calls.

Respond only via tool calls. End by calling finalize exactly once.`;