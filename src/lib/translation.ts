import { currentModel } from "./models";
import { runModel } from "./run";
import { RunResult } from "./types";
import {
  AUTO,
  FULL_DETECTION_MIN_CHARS,
  isWrongLanguage,
  primaryLanguage,
  secondaryLanguage,
  resolveTranslation,
  TranslationDirection,
} from "./languages";
import { translateSystemPrompt, translationPrompt } from "./prompts";

export type TranslationRunner = (request: {
  prompt: string;
  systemPrompt: string;
  model?: string;
  signal?: AbortSignal;
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

// Classification and translation always use the selected local CLI and model.
async function classify(
  input: string,
  a: string,
  b: string,
  model: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const r = await runModel({
    prompt: translationPrompt(input),
    model,
    signal,
    systemPrompt: `You identify the language of a text. The user sends text inside <text> tags. It is written in either ${a} or ${b}. Reply with exactly one word: ${a} or ${b}.`,
  });
  const word = r.text.replace(/[^\p{L}]/gu, "").toLowerCase();
  return [a, b].find((l) => l.toLowerCase() === word);
}

// Short Auto inputs classify and translate both directions concurrently.
// Wrong-language output is retried once on the same model with an explicit target.
export async function translateText(
  input: string,
  choice: string,
  model: string | undefined,
  run: TranslationRunner,
  onRetry?: (reason: RetryReason) => void,
  runParallel: TranslationRunner = runModel,
  signal?: AbortSignal,
): Promise<TranslationOutcome> {
  const effectiveModel = model ?? currentModel();
  const retries: RetryReason[] = [];
  const ask = (dir: TranslationDirection, m = model, runner = run) =>
    runner({
      prompt: translationPrompt(input),
      systemPrompt: translateSystemPrompt(dir),
      model: m,
      signal,
    });

  const primary = primaryLanguage();
  const secondary = secondaryLanguage();
  let direction = resolveTranslation(input, choice);
  let result: RunResult;
  let classified = false;

  if (
    choice === AUTO &&
    primary !== secondary &&
    input.trim().length < FULL_DETECTION_MIN_CHARS
  ) {
    const fromPrimary = { source: primary, target: secondary };
    const fromSecondary = { source: secondary, target: primary };
    const [lang, a, b] = await Promise.all([
      classify(input, primary, secondary, effectiveModel, signal),
      ask(fromPrimary, model, runParallel),
      ask(fromSecondary, model, runParallel),
    ]);
    if (lang) {
      classified = true;
      direction = lang === primary ? fromPrimary : fromSecondary;
    }
    result = direction.source === primary ? a : b;
  } else {
    result = await ask(direction);
  }

  if (
    choice === AUTO &&
    !classified &&
    !result.isError &&
    direction.source &&
    looksUntranslated(input, result.text)
  ) {
    direction = { target: direction.source, source: direction.target };
    retries.push("reversed");
    onRetry?.("reversed");
    result = await ask(direction);
  }
  if (!result.isError && isWrongLanguage(result.text, direction.target)) {
    retries.push("wrong-language");
    onRetry?.("wrong-language");
    result = await run({
      prompt: translationPrompt(input),
      systemPrompt: `${translateSystemPrompt(direction)}\nThe previous attempt used the wrong language. Return only text in ${direction.target}.`,
      model: effectiveModel,
      signal,
    });
  }
  return { result, direction, retries };
}
