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
  parentLinkHref: string | null;
  parentButtonLabel: string | null;
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
  mode: 'declared' | 'undeclared';
  pageLang: string;
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

// One key the LLM tried during SC 2.1.2 escalation, plus the observed effect
export interface EscapeAttempt {
  key: string;
  movedFocus: boolean;
  newSelector: string | null;
}

// Whether/how the trapped element is visually occluded by another element
// (cookie banner, sticky overlay, etc.). Discovered by the LLM
export interface OcclusionInfo {
  isOccluded: boolean;
  occludingSelector: string | null;
  description: string;
}

// One transcript entry from the escalation tool-use loop, kept for auditability
export interface EscalationToolCall {
  tool: string;
  input: Record<string, unknown>;
  resultSummary: string;
}

// Enriched LLM verdict produced by SC 2.1.2 escalation
export interface SC212EscalationResult {
  verdict: 'pass' | 'fail' | 'needs_review';
  rationale: string;
  uncertainty: 'low' | 'medium' | 'high';
  trapLocation: string | null;
  escapeAttempts: EscapeAttempt[];
  occlusion: OcclusionInfo | null;
  rootCause: string;
  suggestedFix: string;
  toolCallCount: number;
  transcript: EscalationToolCall[];
}

// Enriched LLM verdict produced by SC 2.4.4 escalation
export interface SC244EscalationResult {
  verdict: 'pass' | 'fail' | 'needs_review';
  rationale: string;
  uncertainty: 'low' | 'medium' | 'high';
  resolvedPurpose: string;
  contextContainer: string | null;
  rootCause: string;
  suggestedFix: string;
  toolCallCount: number;
  transcript: EscalationToolCall[];
}