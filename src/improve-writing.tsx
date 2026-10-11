import { rewritePrompts } from "./lib/prompts";
import { rewriteSelection, rewriteWith } from "./lib/rewrite";

export default async function Command() {
  await rewriteSelection(
    rewriteWith(rewritePrompts.improveWriting),
    "Improved",
  );
}
