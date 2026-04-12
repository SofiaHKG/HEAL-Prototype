// Shared minimal reference to the DOM element under assessment
export interface ElementRef {
  selector: string;
  outerHTML: string;
  ariaRole?: string | undefined;
  computedName?: string | undefined;
}

// One Evidence bundle = one assessable instance of a WCAG SC
// to be consumed by the LLM assessor
export interface EvidenceBundle {
  sc: string;
  element: ElementRef;
  evidence: Record<string, unknown>;
}

// Evidence shape for SC 1.1.1 (Non-text Content)
export interface SC111Evidence {
  altText: string | null;
  ariaLabel: string | null;
  ariaLabelledbyText: string | null;
  role: string;
  surroundingText: string;
  screenshotBase64: string | null;
  screenshotMimeType: string | null;
}

// Evidence shape for SC 2.4.4 (Link Purpose (In Context))
export interface SC244Evidence {
  accessibleName: string;
  linkHref: string;
  surroundingContext: string;
  ariaSubtree: string;
}

// Evidence shape for SC 3.1.2 (Language of Parts)
export interface SC312Evidence {
  declaredLang: string;
  textContent: string;
  elementTag: string;
}

// One step in the keyboard focus traversal sequence (SC 2.1.2)
export interface FocusStep {
  tabIndex: number;
  selector: string;
  tagName: string;
  id: string | null;
}

// Evidence for SC 2.1.2 (No Keyboard Trap)
export interface SC212Evidence {
  focusSequence: FocusStep[];
  trapDetected: boolean;
  trapType: 'consecutive' | 'cycle' | null;
  stuckSelector: string | null;
  cycleSelectors: string[] | null;
  escapeBehavior: 'moved' | 'stuck' | 'not_tested';
  shiftTabBehavior: 'moved' | 'stuck' | 'not_tested';
  totalTabsPressed: number;
  uniqueSelectorsCount: number;
  totalPageFocusable: number;
}