# HEAL — Hybrid Evidence-based Accessibility with LLMs

Two-layer accessibility scanner for a single URL:

1. **axe-core** (rule-based) — runs the standard ruleset via Playwright.
2. **LLM assessment** (Claude via Anthropic API) — for four WCAG SCs that
   axe cannot decide automatically: 1.1.1, 2.1.2, 2.4.4, 3.1.2. Evidence
   (DOM context, screenshots, ARIA names, focus traces) is collected from
   the live page through a Playwright MCP server, then sent to the model
   together with the SC-specific prompt.

Outputs both `<report>.json` and `<report>.html` under `reports/`.

## Setup

```powershell
npm install
```

Create a `.env` file in the project root
and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The file is read by
`dotenv` on startup; without it, all LLM calls will fail.

Requires Node 20+ and the Playwright browsers that ship with
`@playwright/mcp`.

## Usage

Full aggregate run (all four SCs + axe):

```powershell
npm run eval -- <url> [out-path] [--full|--partial] [--trace=on|--trace=off]
```

Per-SC runs (same flags):

```powershell
npm run eval:sc111 -- <url>
npm run eval:sc212 -- <url>
npm run eval:sc244 -- <url>
npm run eval:sc312 -- <url>
```

Flags:

- `--full` — assess every collected item (default).
- `--partial` — cap at 30 items per SC.
- `--trace=on` — record a Playwright trace of the HEAL/MCP browser session;
  written next to the report as `<report>-mcp-trace.zip`. Open with
  `npx playwright show-trace <path>.zip`.
- `out-path` — optional explicit `.json` path; the matching `.html` is
  derived from it.

## Layout

```
src/
  axe/           axe-core runner
  mcp/           Playwright MCP client + page-evaluate helpers
  evidence/      per-SC evidence collectors (DOM probes, screenshot capture)
  orchestrator/  per-SC pipelines (sampling -> evidence -> LLM -> verdict)
  llm/           Anthropic client wrapper, prompts, schemas
  output/        JSON + HTML reporters (Mustache template)
  eval/          CLI entry points (run.ts and runSC*.ts)
  types/         shared TypeScript types
reports/         generated <report>.json, <report>.html, optional trace zip
```

## Notes

- All four LLM SCs use a three-valued verdict (`pass` / `fail` /
  `needs_review`) plus a `confidence` level (`low` / `medium` / `high`).
- SC 2.1.2 (keyboard trap) runs an escalation probe when the first pass is
  inconclusive (`needs_review`, or `fail` with non-high confidence).
- SC 1.1.1 captures pixel evidence via in-page canvas first; falls back to a
  Node-side fetch + `sharp` downscale for cross-origin/CDN images.
- Run order in the aggregate pipeline: 2.1.2 → 1.1.1 → 2.4.4 → 3.1.2,
  so SC 2.1.2's keyboard probe has a chance to dismiss cookie/consent
  modals before the other SCs collect evidence.
- The HTML report layout and styling are adapted from
  [`axe-html-reporter`](https://github.com/lpelypenko/axe-html-reporter)
  (Mustache template + Bootstrap 4), extended with the HEAL LLM section.