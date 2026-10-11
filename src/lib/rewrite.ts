import {
  Clipboard,
  closeMainWindow,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { runClaude } from "./claude";
import { errorMarkdown } from "./format";
import { RETRY_MODEL } from "./languages";
import { modelLabel } from "./models";
import { REWRITE_SYSTEM_PROMPT } from "./prompts";
import { readSourceText } from "./selection";

// Transforms the selected text and pastes the result over the selection, like
// Raycast AI's "Fix Spelling". No clipboard fallback, so nothing is pasted in
// the wrong place.
export async function rewriteSelection(
  buildPrompt: (text: string) => string,
  doneMessage: string,
  // May depend on the text (translation direction), so it can be a function.
  systemPrompt: string | ((text: string) => string) = REWRITE_SYSTEM_PROMPT,
  // Returns true when the output should be redone once with RETRY_MODEL.
  needsRetry?: (sourceText: string, output: string) => boolean,
) {
  const source = await readSourceText({ allowClipboard: false });
  if (!source) {
    await showHUD("Select some text first");
    return;
  }
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Writing…",
  });
  const request = {
    prompt: buildPrompt(source.text),
    systemPrompt:
      typeof systemPrompt === "function"
        ? systemPrompt(source.text)
        : systemPrompt,
  };
  let result = await runClaude(request);
  if (!result.isError && needsRetry?.(source.text, result.text)) {
    toast.title = `Retrying with ${modelLabel(RETRY_MODEL)}…`;
    result = await runClaude({ ...request, model: RETRY_MODEL });
  }
  if (result.isError || !result.text.trim()) {
    toast.style = Toast.Style.Failure;
    toast.title = "Request failed";
    toast.message = result.error
      ? errorMarkdown(result.error).replace(/[#`]/g, "").trim()
      : "Empty response";
    return;
  }
  await closeMainWindow();
  await Clipboard.paste(result.text.trim());
  await showHUD(doneMessage);
}
