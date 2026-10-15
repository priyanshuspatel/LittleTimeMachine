/**
 * How long a calm reading of `text` takes.
 * The old placeholder was a fixed two-and-a-half-second tone, which did not grow with the quest.
 *
 * @param text - The full passage that will be spoken.
 * @param wordsPerSecond - Pace. About 2.3 matches a slow narration.
 * @returns Whole seconds, at least one when there is any text.
 */
export function estimateNarrationSeconds(text: string, wordsPerSecond = 2.3): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0).length;
  if (words === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(words / wordsPerSecond));
}
