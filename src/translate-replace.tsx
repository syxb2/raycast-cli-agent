import { LocalStorage } from "@raycast/api";
import { runModel } from "./lib/run";
import { AUTO } from "./lib/languages";
import { currentModel, modelLabel } from "./lib/models";
import { rewriteSelection } from "./lib/rewrite";
import { translateText } from "./lib/translation";

// No window: translates the selection into the language last chosen in
// Translate and pastes the result over it.
export default async function Command() {
  const language =
    (await LocalStorage.getItem<string>("translate-language")) ?? AUTO;
  await rewriteSelection(async (text, toast) => {
    const { result } = await translateText(
      text,
      language,
      undefined,
      runModel,
      (reason) => {
        toast.title =
          reason === "reversed"
            ? "Already in that language, reversing…"
            : `Retrying with ${modelLabel(currentModel())}…`;
      },
    );
    return result;
  }, "Translated");
}
