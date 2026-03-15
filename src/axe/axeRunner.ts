import AxeBuilder from '@axe-core/playwright';
import type { Page as PwTestPage } from '@playwright/test';
import type { Page as PwCorePage } from 'playwright-core';
import type { AxeResults } from 'axe-core';

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