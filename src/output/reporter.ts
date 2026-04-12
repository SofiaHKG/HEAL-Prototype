import * as fs from 'fs';
import * as path from 'path';
import type { HealReport, HealFinding, AxeFindingEntry } from './schema';
import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';
import type { AxeNodeFinding } from '../axe/axeRunner';

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

  // Axe summary (if present)
  if (report.axeSummary && report.axeFindings) {
    console.log('\n--- Axe-core (rule-based) ---');
    console.log('Total:      ' + report.axeSummary.total);
    console.log('Fail:       ' + report.axeSummary.fail);
    console.log('Incomplete: ' + report.axeSummary.incomplete);

    if (report.axeFindings.length > 0) {
      console.log('\nAxe findings:');
      for (const f of report.axeFindings) {
        console.log(
          '  [' + f.verdict + '] SC ' + f.sc +
          ' | rule=' + f.ruleId +
          '\n      ' + f.selector +
          (f.failureSummary ? '\n      ' + f.failureSummary : '')
        );
      }
    }
  }

  // LLM assessment summary
  console.log('\n--- LLM Assessment ---');
  console.log('Total:     ' + report.summary.total);
  console.log('Pass:      ' + report.summary.pass);
  console.log('Fail:      ' + report.summary.fail);
  console.log('Review:    ' + report.summary.needs_review);

  if (report.findings.length === 0) {
    console.log('\nNo LLM findings.');
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

// Build aggregate report combining axe findings + LLM results from all SCs
export function buildAggregateReport(
  url: string,
  axeNodeFindings: { sc: string; findings: AxeNodeFinding[] }[],
  scResults: SCResult[],
): HealReport {
  // Convert axe findings (only fail/incomplete come from getAxeFindingsForSC)
  const axeFindings: AxeFindingEntry[] = [];
  for (const group of axeNodeFindings) {
    for (const f of group.findings) {
      if (f.verdict !== 'fail' && f.verdict !== 'incomplete') continue;
      axeFindings.push({
        ruleId: f.ruleId,
        sc: group.sc,
        verdict: f.verdict,
        selector: f.selector,
        html: f.html,
        failureSummary: f.failureSummary,
        helpUrl: f.helpUrl,
      });
    }
  }

  const axeSummary = {
    total: axeFindings.length,
    fail: axeFindings.filter(f => f.verdict === 'fail').length,
    incomplete: axeFindings.filter(f => f.verdict === 'incomplete').length,
  };

  // Convert LLM results (same as buildReport)
  const findings: HealFinding[] = scResults.map((r) => ({
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
    pass: findings.filter(f => f.verdict === 'pass').length,
    fail: findings.filter(f => f.verdict === 'fail').length,
    needs_review: findings.filter(f => f.verdict === 'needs_review').length,
  };

  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    url,
    axeFindings,
    findings,
    summary,
    axeSummary,
  };
}