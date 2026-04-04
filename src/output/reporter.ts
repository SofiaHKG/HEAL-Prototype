import * as fs from 'fs';
import * as path from 'path';
import type { HealReport, HealFinding } from './schema';
import type { SC312Result } from '../orchestrator/sc312orchstrator';

// Builder to convert SC312Result[] into a HealReport
export function buildReport(url: string, sc312Results: SC312Result[]): HealReport {
  const findings: HealFinding[] = sc312Results.map((r) => ({
    sc: r.bundle.sc,
    selector: r.bundle.element.selector,
    outerHTML: r.bundle.element.outerHTML,
    evidence: r.bundle.evidence,
    verdict: r.assessment.verdict,
    rationale: r.assessment.rationale,
    uncertainty: r.assessment.uncertainty,
  }));

  const summary = {
    total: findings.length,
    pass: findings.filter((f) => f.verdict === 'pass').length,
    fail: findings.filter((f) => f.verdict === 'fail').length,
    needs_review: findings.filter((f) => f.verdict === 'needs_review').length,
  };

  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    url,
    findings,
    summary,
  };
}

// Write a HealReport as formattet JSON
export async function writeReport(report: HealReport, outPath: string): Promise<void> {
  const resolved = path.resolve(outPath);
  const dir = path.dirname(resolved);

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(resolved, JSON.stringify(report, null, 2), 'utf-8');

  console.log('Report written to: ' + resolved);
}