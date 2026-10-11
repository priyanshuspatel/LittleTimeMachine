function isPreamble(sentence: string): boolean {
  const words = sentence.replace(/[.!?]+$/g, "").trim().split(/\s+/);
  if (words.length > 6) {
    return false;
  }
  return /^(sure|okay|ok|here(?:'s| is)?|certainly|of course|absolutely|got it|alright|i can|let me)\b/i.test(
    sentence,
  );
}

/** Keep the first `count` sentences. Small local models often add a preamble. */
export function takeSentences(text: string, count: number): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = (cleaned.match(/[^.!?]+[.!?]+/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !isPreamble(sentence));

  if (sentences.length === 0) {
    return cleaned.replace(/^["']+|["']+$/g, "");
  }

  return sentences.slice(0, count).join(" ");
}
