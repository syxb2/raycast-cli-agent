import { getPreferenceValues } from "@raycast/api";
import { franc, francAll } from "franc-min";

export interface Language {
  // English name, used in prompts and as the preference value.
  name: string;
  // ISO 639-3 code as used by franc.
  code: string;
}

// Limited to languages franc-min can recognize (Latin scripts via trigrams,
// others via their script).
export const LANGUAGES: Language[] = [
  { name: "English", code: "eng" },
  { name: "Arabic", code: "arb" },
  { name: "Chinese", code: "cmn" },
  { name: "Czech", code: "ces" },
  { name: "Dutch", code: "nld" },
  { name: "French", code: "fra" },
  { name: "German", code: "deu" },
  { name: "Greek", code: "ell" },
  { name: "Hebrew", code: "heb" },
  { name: "Hindi", code: "hin" },
  { name: "Hungarian", code: "hun" },
  { name: "Indonesian", code: "ind" },
  { name: "Italian", code: "ita" },
  { name: "Japanese", code: "jpn" },
  { name: "Korean", code: "kor" },
  { name: "Persian", code: "pes" },
  { name: "Polish", code: "pol" },
  { name: "Portuguese", code: "por" },
  { name: "Romanian", code: "ron" },
  { name: "Russian", code: "rus" },
  { name: "Spanish", code: "spa" },
  { name: "Swedish", code: "swe" },
  { name: "Turkish", code: "tur" },
  { name: "Ukrainian", code: "ukr" },
  { name: "Vietnamese", code: "vie" },
];

export const AUTO = "auto";

export function primaryLanguage(): string {
  return getPreferenceValues<Preferences>().primaryLanguage || "English";
}

export function secondaryLanguage(): string {
  return getPreferenceValues<Preferences>().secondaryLanguage || "English";
}

function codeOf(name: string): string | undefined {
  return LANGUAGES.find((l) => l.name === name)?.code;
}

// Leaving the "auto" direction to the model was unreliable (2026-10-11
// test with Haiku: it returned a Turkish list untranslated and translated a
// question into French). Instead the extension decides and always sends a
// single target language.
//
// General language detection is unreliable on short text (15/20 with
// tinyld). The question here is narrower, "primary or secondary?", so franc
// only chooses between those two: 25/27 correct, misses were one-word inputs.
export function isInLanguage(
  text: string,
  language: string,
  other: string,
): boolean {
  const a = codeOf(language);
  const b = codeOf(other);
  if (!a || !b) return false;
  return franc(text, { only: [a, b], minLength: 1 }) === a;
}

// Long enough for full detection to be trustworthy (on short text it mistook
// Turkish for Indonesian).
export const FULL_DETECTION_MIN_CHARS = 30;
const ALL_CODES = LANGUAGES.map((l) => l.code);

function detectLong(text: string): string | undefined {
  if (text.trim().length < FULL_DETECTION_MIN_CHARS) return undefined;
  const [top] = francAll(text, { only: ALL_CODES });
  return LANGUAGES.find((l) => l.code === top?.[0])?.name;
}

export interface TranslationDirection {
  target: string;
  // Sent to the model when known: with only a target, Haiku sometimes
  // returned the text untranslated.
  source?: string;
}

// "auto": text in the primary language goes to the secondary one; text in the
// secondary or any other language goes to the primary one.
export function resolveTranslation(
  text: string,
  choice: string,
): TranslationDirection {
  const detected = detectLong(text);
  if (choice !== AUTO) {
    return {
      target: choice,
      source: detected !== choice ? detected : undefined,
    };
  }
  const primary = primaryLanguage();
  const secondary = secondaryLanguage();
  if (primary === secondary) return { target: primary };
  if (detected && detected !== primary && detected !== secondary) {
    return { target: primary, source: detected };
  }
  return isInLanguage(text, primary, secondary)
    ? { target: secondary, source: primary }
    : { target: primary, source: secondary };
}

const OUTPUT_CHECK_MIN_CHARS = 20;

// Haiku sometimes answers in the wrong language, e.g. German → Turkish came
// back as English or untouched German (2/3 and 3/3 runs on 2026-10-11, while
// Sonnet was right). Flags such output so the caller can retry.
export function isWrongLanguage(output: string, target: string): boolean {
  const code = codeOf(target);
  if (!code || output.trim().length < OUTPUT_CHECK_MIN_CHARS) return false;
  const scores = francAll(output, { only: ALL_CODES });
  if (!scores.length || scores[0][0] === "und") return false;
  const targetScore = scores.find(([c]) => c === code)?.[1] ?? 0;
  return targetScore < 0.8;
}

export function autoLabel(): string {
  const primary = primaryLanguage();
  const secondary = secondaryLanguage();
  return primary === secondary
    ? `Auto (→ ${primary})`
    : `Auto (${primary} ↔ ${secondary})`;
}
