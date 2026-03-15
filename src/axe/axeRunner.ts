import AxeBuilder from '@axe-core/playwright';
import type { Page as PwTestPage } from '@playwright/test';
import type { Page as PwCorePage } from 'playwright-core';
import type { AxeResults } from 'axe-core';

type AnyPage = PwTestPage | PwCorePage;

export async function runAxe(page: AnyPage): Promise<AxeResults> {
  return new AxeBuilder({ page: page as PwCorePage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
}