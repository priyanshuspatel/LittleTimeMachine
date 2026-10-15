const ABBREVIATION = /\b(Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr)\./g;
const ABBREVIATION_MARK = "\uE000";

function protectAbbreviations(value: string): string {
  return value.replace(ABBREVIATION, (_match, word: string) => `${word}${ABBREVIATION_MARK}`);
}

function restoreAbbreviations(value: string): string {
  return value.replaceAll(ABBREVIATION_MARK, ".");
}

function isPreamble(sentence: string): boolean {
  const words = sentence.replace(/[.!?]+$/g, "").trim().split(/\s+/);
  if (words.length > 6) {
    return false;
  }
  return /^(sure|okay|ok|here(?:'s| is)?|certainly|of course|absolutely|got it|alright|i can|let me)\b/i.test(
    sentence,
  );
}

/**
 * Keeps the first `count` sentences.
 * Small local models often add a preamble or keep writing past the requested length.
 * Periods that belong to a short honorific (`Dr.`, `Mr.`) are not treated as boundaries.
 *
 * @param text - Model output, which may include a code fence or a chatty lead-in.
 * @param count - Maximum number of sentences to keep. Zero or less yields an empty string.
 * @returns The trimmed sentences joined by a single space, or the cleaned text when it has no terminator.
 */
export function takeSentences(text: string, count: number): string {
  if (count <= 0) {
    return "";
  }

  const cleaned = restoreAbbreviations(
    protectAbbreviations(text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const protectedText = protectAbbreviations(cleaned);

  const sentences = (protectedText.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((sentence) => restoreAbbreviations(sentence).trim())
    .filter((sentence) => sentence.length > 0 && !isPreamble(sentence));

  if (sentences.length === 0) {
    return cleaned.replace(/^["']+|["']+$/g, "");
  }

  return sentences.slice(0, count).join(" ");
}
