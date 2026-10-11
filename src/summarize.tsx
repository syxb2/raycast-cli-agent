import { SelectionAnswer } from "./components/SelectionAnswer";
import { summarizePrompt } from "./lib/prompts";

export default function Command() {
  return (
    <SelectionAnswer
      navigationTitle="Özet"
      buildPrompt={summarizePrompt}
      question={(s) => `Özetle: ${s.text}`}
    />
  );
}
