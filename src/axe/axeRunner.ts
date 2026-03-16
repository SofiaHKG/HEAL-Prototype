import AxeBuilder from '@axe-core/playwright';
import type { Page as PwTestPage } from '@playwright/test';
import type { Page as PwCorePage } from 'playwright-core';
import type { AxeResults, NodeResult, Result } from 'axe-core';

type AnyPage = PwTestPage | PwCorePage;

// Mapping WCAG SC to axe-core rule IDs
export const SC_RULE_MAP: Record<string, string[]> = {
  '1.1.1': ['aria-meter-name', 'aria-progressbar-name', 'image-alt', 'input-image-alt', 'object-alt', 'role-img-alt', 'svg-img-alt', 'image-redundant-alt'],
  '2.4.4': ['area-alt', 'link-name'],
  '3.1.2': ['valid-lang'],
  '2.1.2': [],
};

// Helper types for axe verdict
export type AxeVerdict = 'fail' | 'incomplete' | 'pass' | 'none';

export interface AxeNodeFinding {
  ruleId: string;
  verdict: Exclude<AxeVerdict, 'none'>;
  selector: string;
  html: string;
  failureSummary: string | undefined;
  helpUrl: string;
}

export async function runAxe(page: AnyPage): Promise<AxeResults> {
  return new AxeBuilder({ page: page as PwCorePage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}

// Extract axe findings relevant to specific SC from AxeResults object
export function getAxeFindingsForSC(results: AxeResults, sc: string): AxeNodeFinding[] {
  const ruleIds = SC_RULE_MAP[sc] ?? [];
  if (ruleIds.length === 0) return [];

  const findings: AxeNodeFinding[] = [];

  for (const ruleId of ruleIds) {
    extractFromResults(results.violations, ruleId, 'fail', findings);
    extractFromResults(results.incomplete, ruleId, 'incomplete', findings);
  }

  return findings; // Returns one AxeNodeFinding per affected element per rule
}

function extractFromResults(
  results: Result[],
  ruleId: string,
  verdict: 'fail' | 'incomplete',
  out: AxeNodeFinding[]
): void {
  const match = results.find(r => r.id === ruleId);
  if (!match) return;

  for (const node of match.nodes) {
    out.push({
      ruleId,
      verdict,
      selector: resolveSelector(node),
      html: node.html,
      failureSummary: node.failureSummary,
      helpUrl: match.helpUrl,
    });
  }
}

// Resolve the primary CSS selector froma NodeResult target
function resolveSelector(node: NodeResult): string {
  const target = node.target;
  if (Array.isArray(target) && target.length > 0) {
    const last = target[target.length - 1];
    return typeof last === 'string' ? last : String(last);
  }
  return '';
}