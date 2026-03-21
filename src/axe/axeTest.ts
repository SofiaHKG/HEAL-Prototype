import { chromium } from '@playwright/test';
import { runAxe, getAxeFindingsForSC, SC_RULE_MAP } from './axeRunner';

const TARGET_URL = '/**/';

// Run with: 
// npm run test:axe
async function runAxeTest(): Promise<void> {
  console.log('--- Starting HEAL Axe Integration Test ---\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Navigate
    console.log(`1. Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
    console.log('  [OK] Navigation complete\n');

    // 2. Run axe
    console.log('2. Running axe-core scan...');
    const results = await runAxe(page);
    console.log(`  [OK] Scan complete`);
    console.log(`   violations : ${results.violations.length}`);
    console.log(`   incomplete : ${results.incomplete.length}`);
    console.log(`   passes     : ${results.passes.length}\n`);

    // 3. Per-SC extraction
    console.log('3. Extracting per-SC findings...');
    const targetSCs = Object.keys(SC_RULE_MAP);

    for (const sc of targetSCs) {
      const findings = getAxeFindingsForSC(results, sc);
      console.log(`   SC ${sc}: ${findings.length} finding(s)`);
      for (const f of findings.slice(0, 2)) {
        // Print first two to keep output readable
        console.log(`     [${f.verdict}] rule=${f.ruleId} selector=${f.selector}`);
      }
      if (findings.length > 2) {
        console.log(`     ... and ${findings.length - 2} more`);
      }
    }

    // 4. Structural assertions
    console.log('\n4. Checking structural assertions...');

    if (results.violations.length === 0 && results.incomplete.length === 0) {
      console.log('  [OK] No violations or incomplete items found! -> Structural assertions skipped');
    } else {
      const sc111Findings = getAxeFindingsForSC(results, '1.1.1');
      const sc244Findings = getAxeFindingsForSC(results, '2.4.4');

      // Each finding must have a non-empty selector and html
      const allFindings = [...sc111Findings, ...sc244Findings];
      for (const f of allFindings) {
        if (!f.selector) throw new Error(`Finding for rule ${f.ruleId} has empty selector`);
        if (!f.html) throw new Error(`Finding for rule ${f.ruleId} has empty html`);
        if (f.verdict !== 'fail' && f.verdict !== 'incomplete') {
          throw new Error(`  [ERROR] Unexpected verdict "${f.verdict}" for rule ${f.ruleId}`);
        }
      }
      console.log(`  [OK] All ${allFindings.length} findings have valid selector, html and verdict`);
    }

    console.log('\n--- Axe integration test passed. Yay! ---');

  } finally {
    await context.close();
    await browser.close();
  }
}

runAxeTest().catch((err: unknown) => {
  console.error('\n[ERROR] Axe test FAILED:', err);
  process.exit(1);
});
