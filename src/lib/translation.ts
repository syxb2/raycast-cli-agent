import { RunResult } from "./claude";
import {
  AUTO,
  isWrongLanguage,
  resolveTranslation,
  RETRY_MODEL,
  TranslationDirection,
} from "./languages";
import { translateSystemPrompt, translationPrompt } from "./prompts";

export type TranslationRunner = (request: {
  prompt: string;
  systemPrompt: string;
  model?: string;
}) => Promise<RunResult>;

export type RetryReason = "reversed" | "wrong-language";

export interface TranslationOutcome {
  result: RunResult;
  direction: TranslationDirection;
  retries: RetryReason[];
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

const MAX_COMPARE_CHARS = 2000;

// Output that is (almost) the input, ignoring accents, case and punctuation:
// the text was already in the target language.
export function looksUntranslated(input: string, output: string): boolean {
  const a = normalize(input).slice(0, MAX_COMPARE_CHARS);
  const b = normalize(output).slice(0, MAX_COMPARE_CHARS);
  if (!a || !b) return false;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.85;
}

// Short text without accents is easy to misdetect ("benim adim ne" scored as
// English, so Auto "translated" it into Turkish and only fixed the accents).
// In Auto mode an untranslated result means the direction was wrong, so it is
// reversed once. Then a wrong-language result is retried once with Sonnet.
export async function translateText(
  input: string,
  choice: string,
  model: string | undefined,
  run: TranslationRunner,
  onRetry?: (reason: RetryReason) => void,
): Promise<TranslationOutcome> {
  let direction = resolveTranslation(input, choice);
  const retries: RetryReason[] = [];
  const ask = (m = model) =>
    run({
      prompt: translationPrompt(input),
      systemPrompt: translateSystemPrompt(direction),
      model: m,
    });

  let result = await ask();
  if (
    choice === AUTO &&
    !result.isError &&
    direction.source &&
    looksUntranslated(input, result.text)
  ) {
    direction = { target: direction.source, source: direction.target };
    retries.push("reversed");
    onRetry?.("reversed");
    result = await ask();
  }
  if (
    !result.isError &&
    model !== RETRY_MODEL &&
    isWrongLanguage(result.text, direction.target)
  ) {
    retries.push("wrong-language");
    onRetry?.("wrong-language");
    result = await ask(RETRY_MODEL);
  }
  return { result, direction, retries };
}
