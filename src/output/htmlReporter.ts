import * as fs from 'fs';
import * as path from 'path';
import mustache from 'mustache';
import type { HealReport } from './schema';

const SC_TITLES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '2.1.2': 'No Keyboard Trap',
  '2.4.4': 'Link Purpose (In Context)',
  '3.1.2': 'Language of Parts',
};

const AXE_RULE_HELP_FALLBACK: Record<string, string> = {
  'image-alt': 'Images must have alternative text',
  'input-image-alt': 'Image buttons must have alternative text',
  'object-alt': '<object> elements must have alternative text',
  'role-img-alt': '[role="img"] elements must have alternative text',
  'svg-img-alt': '<svg> elements with an img role must have alternative text',
  'image-redundant-alt': 'Image alt text should not be redundant',
  'area-alt': 'Active <area> elements must have alternative text',
  'link-name': 'Links must have discernible text',
  'valid-lang': 'lang attribute must have a valid value',
};

function loadTemplate(): Promise<string> {
  return fs.promises.readFile(
    path.resolve(__dirname, 'template', 'healReport.html'),
    'utf-8'
  );
}

interface FixSummary {
  highlight: string;
  list: string[];
}

interface AxeNodeView {
  index: number;
  html: string;
  targetNodes: string;
  fixSummaries: FixSummary[];
}

interface AxeDetailView {
  index: number;
  id: string;
  sc: string;
  wcag: string;
  title: string;
  help: string;
  description: string;
  impact: string;
  helpUrl: string;
  nodeCount: number;
  nodes: AxeNodeView[];
}

interface HealFindingView {
  index: number;
  verdict: string;
  confidence: string;
  selector: string;
  outerHTML: string;
  rationale: string;
  screenshotDataUrl: string;
  hasScreenshot: boolean;
  isPass: boolean;
  isFail: boolean;
  isReview: boolean;
}

interface HealSectionView {
  sc: string;
  scTitle: string;
  isSc111: boolean;
  findings: HealFindingView[];
}

function getWcagReference(sc: string): string {
  return 'WCAG ' + sc;
}

function parseFailureSummary(summary: string | undefined): FixSummary[] {
  if (!summary) {
    return [];
  }

  const lines = summary.split(/\r?\n/);
  const blocks: FixSummary[] = [];
  let current: FixSummary | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      continue;
    }

    // Heading lines are unindented and end with ":" (e.g. "Fix all of the following:").
    const isHeading = /^\S.*:$/.test(line);
    if (isHeading) {
      current = { highlight: line, list: [] };
      blocks.push(current);
      continue;
    }

    const item = line.trim();
    if (current) {
      current.list.push(item);
    } else {
      // No heading seen yet — surface the line as a standalone highlight.
      blocks.push({ highlight: item, list: [] });
    }
  }

  return blocks;
}

function extractScreenshotDataUrl(evidence: Record<string, unknown>): string | null {
  const base64 = evidence['screenshotBase64'];
  const mime = evidence['screenshotMimeType'];

  if (typeof base64 !== 'string' || base64.length === 0) {
    return null;
  }

  if (typeof mime !== 'string' || mime.length === 0) {
    return null;
  }

  if (base64.startsWith('data:')) {
    return base64;
  }

  return 'data:' + mime + ';base64,' + base64;
}

function prepareAxeViolationDetails(report: HealReport): {
  summaryTable: AxeDetailView[];
  details: AxeDetailView[];
  summaryText: string;
} {
  const entries = report.axeFindings ?? [];
  if (entries.length === 0) {
    return {
      summaryTable: [],
      details: [],
      summaryText: 'axe-core found <span class="badge badge-success">0</span> violations',
    };
  }

  // Group by ruleId
  const ruleGroups = new Map<string, typeof entries>();
  for (const e of entries) {
    const group = ruleGroups.get(e.ruleId);
    if (group) {
      group.push(e);
    } else {
      ruleGroups.set(e.ruleId, [e]);
    }
  }

  const details: AxeDetailView[] = [];
  let idx = 0;
  for (const [ruleId, group] of ruleGroups) {
    idx++;
    const first = group[0]!;
    details.push({
      index: idx,
      id: ruleId,
      sc: first.sc,
      wcag: getWcagReference(first.sc),
      title: ruleId + ' (' + first.verdict + ')',
      help: first.help ?? AXE_RULE_HELP_FALLBACK[ruleId] ?? ruleId,
      description: first.help ?? AXE_RULE_HELP_FALLBACK[ruleId] ?? '',
      impact: first.verdict,
      helpUrl: first.helpUrl,
      nodeCount: group.length,
      nodes: group.map((e, ni) => ({
        index: ni + 1,
        html: e.html,
        targetNodes: e.selector,
        fixSummaries: parseFailureSummary(e.failureSummary),
      })),
    });
  }

  const totalNodes = entries.length;
  const summaryText =
    'axe-core found <span class="badge badge-warning">' +
    totalNodes + '</span> violation' + (totalNodes === 1 ? '' : 's');

  return { summaryTable: details, details, summaryText };
}

function describeSc212Location(f: { evidence: Record<string, unknown>; escalation?: unknown }): {
  selector: string;
  outerHTML: string;
} {
  const ev = f.evidence;
  const esc = f.escalation as Record<string, unknown> | undefined;

  const stuckSelector = typeof ev['stuckSelector'] === 'string' ? ev['stuckSelector'] as string : null;
  const trapType = typeof ev['trapType'] === 'string' ? ev['trapType'] as string : null;
  const cycleSelectors = Array.isArray(ev['cycleSelectors']) ? ev['cycleSelectors'] as string[] : null;
  const totalTabs = typeof ev['totalTabsPressed'] === 'number' ? ev['totalTabsPressed'] as number : null;
  const uniqueCount = typeof ev['uniqueSelectorsCount'] === 'number' ? ev['uniqueSelectorsCount'] as number : null;
  const totalFocusable = typeof ev['totalPageFocusable'] === 'number' ? ev['totalPageFocusable'] as number : null;
  const escalationTrap = esc && typeof esc['trapLocation'] === 'string' ? esc['trapLocation'] as string : null;

  // Best available "where" — prefer the escalation's investigated location.
  const where = escalationTrap ?? stuckSelector ?? '(page-level — no single trap selector identified)';

  // Build a small evidence summary for the "source" cell.
  const lines: string[] = [];
  if (trapType) lines.push('Trap type: ' + trapType);
  if (totalTabs !== null) {
    const focusableNote =
      totalFocusable !== null ? ' / ' + totalFocusable + ' focusable on page' : '';
    const uniqueNote =
      uniqueCount !== null ? ', ' + uniqueCount + ' unique selector(s) visited' : '';
    lines.push('Tabs pressed: ' + totalTabs + focusableNote + uniqueNote);
  }
  if (cycleSelectors && cycleSelectors.length > 0) {
    lines.push('Cycle members:');
    for (const sel of cycleSelectors) lines.push('  - ' + sel);
  }

  return {
    selector: where,
    outerHTML: lines.length > 0 ? lines.join('\n') : '(no traversal details captured)',
  };
}

function prepareHealSections(report: HealReport): HealSectionView[] {
  const scOrder = ['1.1.1', '2.1.2', '2.4.4', '3.1.2'];
  const sections: HealSectionView[] = [];

  for (const sc of scOrder) {
    const scFindings = report.findings.filter(f => f.sc === sc);
    sections.push({
      sc,
      scTitle: SC_TITLES[sc] ?? sc,
      isSc111: sc === '1.1.1',
      findings: scFindings.map((f, i) => {
        const screenshotDataUrl = extractScreenshotDataUrl(f.evidence);
        const { selector, outerHTML } =
          sc === '2.1.2'
            ? describeSc212Location(f)
            : { selector: f.selector, outerHTML: f.outerHTML };
        return {
        index: i + 1,
        verdict: f.verdict,
        confidence: f.confidence,
        selector,
        outerHTML,
        rationale: f.rationale,
        screenshotDataUrl: screenshotDataUrl ?? '',
        hasScreenshot: screenshotDataUrl !== null,
        isPass: f.verdict === 'pass',
        isFail: f.verdict === 'fail',
        isReview: f.verdict === 'needs_review',
        };
      }),
    });
  }

  return sections;
}

export async function createHealHtmlReport(report: HealReport): Promise<string> {
  const template = await loadTemplate();

  const axeData = prepareAxeViolationDetails(report);
  const healSections = prepareHealSections(report);

  const view = {
    url: report.url,
    timestamp: report.timestamp,
    // Axe section
    axeViolationsSummary: axeData.summaryText,
    axeViolationsSummaryTable: axeData.summaryTable,
    axeViolationDetails: axeData.details,
    // HEAL LLM section
    healTotal: report.summary.total,
    healPass: report.summary.pass,
    healFail: report.summary.fail,
    healReview: report.summary.needs_review,
    healSections,
  };

  return mustache.render(template, view);
}

export async function saveHealHtmlReport(report: HealReport, outPath: string): Promise<void> {
  const html = await createHealHtmlReport(report);
  const resolved = path.resolve(outPath);
  const dir = path.dirname(resolved);

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(resolved, html, 'utf-8');
  console.log('HTML report written to: ' + resolved);
}