import { Clipboard, getSelectedText } from "@raycast/api";

export interface SourceText {
  text: string;
  from: "selection" | "clipboard";
}

// getSelectedText rejects when nothing is selected; read-only commands fall
// back to the clipboard.
export async function readSourceText({
  allowClipboard,
}: {
  allowClipboard: boolean;
}): Promise<SourceText | undefined> {
  try {
    const text = (await getSelectedText()).trim();
    if (text) return { text, from: "selection" };
  } catch {
    // nothing selected
  }
  if (!allowClipboard) return undefined;
  const clip = (await Clipboard.readText())?.trim();
  return clip ? { text: clip, from: "clipboard" } : undefined;
}
