import { SelectionAnswer } from "./components/SelectionAnswer";
import { explainPrompt } from "./lib/prompts";

export default function Command() {
  return (
    <SelectionAnswer
      navigationTitle="Açıklama"
      buildPrompt={explainPrompt}
      question={(s) => `Açıkla: ${s.text}`}
    />
  );
}
