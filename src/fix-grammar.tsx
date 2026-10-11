import { rewritePrompts } from "./lib/prompts";
import { rewriteSelection } from "./lib/rewrite";

export default async function Command() {
  await rewriteSelection(rewritePrompts.fixGrammar, "Düzeltildi");
}
