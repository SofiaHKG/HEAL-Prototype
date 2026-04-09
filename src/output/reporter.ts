import * as fs from 'fs';
import * as path from 'path';
import type { HealReport, HealFinding } from './schema';
import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';

// Shared result shape - SC111Result, SC312Result etc. all satisfy this
export interface SCResult {
  bundle: EvidenceBundle;
  assessment: Assessment;
}

// Builder to convert any SCResult[] into a HealReport
export function buildReport(url: string, results: SCResult[]): HealReport {
  const findings: HealFinding[] = results.map((r) => ({
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

// Write a HealReport as formatted JSON
export async function writeReport(report: HealReport, outPath: string): Promise<void> {
  const resolved = path.resolve(outPath);
  const dir = path.dirname(resolved);

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(resolved, JSON.stringify(report, null, 2), 'utf-8');

  console.log('Report written to: ' + resolved);
}

// Print report summary to stdout
export function printSummary(report: HealReport): void {
  console.log('\n=== HEAL Report ===');
  console.log('URL:       ' + report.url);
  console.log('Timestamp: ' + report.timestamp);
  console.log('Total:     ' + report.summary.total);
  console.log('Pass:      ' + report.summary.pass);
  console.log('Fail:      ' + report.summary.fail);
  console.log('Review:    ' + report.summary.needs_review);

  if (report.findings.length === 0) {
    console.log('\nNo findings.');
    return;
  }

  console.log('\nFindings:');
  for (const f of report.findings) {
    const flag = f.verdict === 'pass' ? '[pass]' : f.verdict === 'fail' ? '[fail]' : '[needs review]';
    console.log(
      '  [' + flag + '] SC ' + f.sc +
      ' | ' + f.verdict.toUpperCase() +
      ' (' + f.uncertainty + ')' +
      '\n      ' + f.selector +
      '\n      ' + f.rationale
    );
  }
}