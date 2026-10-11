import { LocalStorage } from "@raycast/api";
import { AUTO, isWrongLanguage, resolveTranslation } from "./lib/languages";
import { translateSystemPrompt, translationPrompt } from "./lib/prompts";
import { rewriteSelection } from "./lib/rewrite";

// No window: translates the selection into the language last chosen in
// Translate and pastes the result over it.
export default async function Command() {
  const language =
    (await LocalStorage.getItem<string>("translate-language")) ?? AUTO;
  await rewriteSelection(
    translationPrompt,
    "Translated",
    (t) => translateSystemPrompt(resolveTranslation(t, language)),
    (t, output) =>
      isWrongLanguage(output, resolveTranslation(t, language).target),
  );
}
