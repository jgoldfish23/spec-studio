import { sampleComps } from "../data/sample";
import type { Comp } from "@engine";

/** The ids tests give the sample's comps, in fixture order, so a test can name one without looking it up. */
export const TEST_SAMPLE_IDS: readonly string[] = Array.from(
  { length: 8 },
  (_, i) => `5a3e0c0e-5a3e-4000-8000-00000000000${i + 1}`,
);

/** The sample's comps with the same ids on every call (the real ones get new random ids each time). */
export function testSampleComps(): Comp[] {
  let n = 0;
  return sampleComps(() => TEST_SAMPLE_IDS[n++] as string);
}
