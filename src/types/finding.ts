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