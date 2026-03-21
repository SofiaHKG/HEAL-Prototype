// See: https://github.com/microsoft/playwright 
// playwright/packages/playwright-core/src/tools/backend/response.ts
// Format defined in response.ts (see line 213) 
// This is where the MCP backend calls addSection('Ran Playwright code', this._code, 'js') 
// to assemble the tool response

export function parseEvalJson<T>(raw: string): T {
  const match = raw.match(
    /###\s*Result\s*[\r\n]+([\s\S]*?)[\r\n]+###\s*Ran Playwright code/
  );

  // noUncheckedIndexedAccess: match[1] is string | undefined
  if (match !== null && match[1] !== undefined) {
    const extracted = match[1].trim();
    try {
      return JSON.parse(extracted) as T;
    } catch (e) {
      throw new Error(
        'parseEvalJson: failed to parse extracted value.\n' +
          'Extracted: ' + extracted.slice(0, 300) + '\n' +
          'Error: ' + String(e)
      );
    }
  }

  return JSON.parse(raw.trim()) as T;
}
