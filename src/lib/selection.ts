import { Clipboard, getSelectedText } from "@raycast/api";

export interface SourceText {
  text: string;
  from: "selection" | "clipboard";
}

// getSelectedText secim yoksa reddeder; okuma komutlarinda panoya dusulur.
export async function readSourceText({
  allowClipboard,
}: {
  allowClipboard: boolean;
}): Promise<SourceText | undefined> {
  try {
    const text = (await getSelectedText()).trim();
    if (text) return { text, from: "selection" };
  } catch {
    // secim yok
  }
  if (!allowClipboard) return undefined;
  const clip = (await Clipboard.readText())?.trim();
  return clip ? { text: clip, from: "clipboard" } : undefined;
}
