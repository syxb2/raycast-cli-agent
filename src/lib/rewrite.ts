import {
  Clipboard,
  closeMainWindow,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { runClaude } from "./claude";
import { errorMarkdown } from "./format";
import { REWRITE_SYSTEM_PROMPT } from "./prompts";
import { readSourceText } from "./selection";

// Secili metni donusturup secimin yerine yapistirir (Raycast AI'in
// "Fix Spelling" davranisi). Yanlis yere yazmamak icin panoya dusulmez.
export async function rewriteSelection(
  buildPrompt: (text: string) => string,
  doneMessage: string,
  // Metne gore degisebilir (ceviri yonu), o yuzden fonksiyon da olabilir.
  systemPrompt: string | ((text: string) => string) = REWRITE_SYSTEM_PROMPT,
) {
  const source = await readSourceText({ allowClipboard: false });
  if (!source) {
    await showHUD("Önce bir metin seç");
    return;
  }
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Claude yazıyor…",
  });
  const result = await runClaude({
    prompt: buildPrompt(source.text),
    systemPrompt:
      typeof systemPrompt === "function"
        ? systemPrompt(source.text)
        : systemPrompt,
  });
  if (result.isError || !result.text.trim()) {
    toast.style = Toast.Style.Failure;
    toast.title = "Claude hata verdi";
    toast.message = result.error
      ? errorMarkdown(result.error).replace(/[#`]/g, "").trim()
      : "Boş cevap";
    return;
  }
  await closeMainWindow();
  await Clipboard.paste(result.text.trim());
  await showHUD(doneMessage);
}
