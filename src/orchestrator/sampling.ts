export type SampleMode = 'full' | 'partial';

export const SAMPLE_CAP = 30;

export function sampleItems<T>(items: T[], mode: SampleMode): T[] {
  if (mode === 'full' || items.length <= SAMPLE_CAP) {
    return items.slice();
  }

  return items.slice(0, SAMPLE_CAP);
}

export function describeSampleMode(mode: SampleMode, total: number, kept: number): string {
  if (mode === 'full' || total === kept) {
    return `${total} item(s)`;
  }
  return `${kept}/${total} item(s) (first ${SAMPLE_CAP}, partial mode)`;
}
