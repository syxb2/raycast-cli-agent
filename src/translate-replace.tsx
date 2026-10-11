import { LocalStorage } from "@raycast/api";
import { resolveTargetLanguage, translateSystemPrompt } from "./lib/prompts";
import { rewriteSelection } from "./lib/rewrite";

// Pencere acmadan: secimi Cevir komutunda son secilen dile cevirip yerine yapistirir.
export default async function Command() {
  const language =
    (await LocalStorage.getItem<string>("translate-language")) ?? "auto";
  await rewriteSelection(
    (t) => t,
    "Çevrildi",
    (t) => translateSystemPrompt(resolveTargetLanguage(t, language)),
  );
}
