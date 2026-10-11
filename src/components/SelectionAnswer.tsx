import { Detail, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { readSourceText, SourceText } from "../lib/selection";
import { AnswerView } from "./AnswerView";

interface Props {
  buildPrompt: (text: string) => string;
  question: (source: SourceText) => string;
  systemPrompt?: string;
  navigationTitle: string;
}

// Reads the selection and hands it to AnswerView; falls back to the clipboard.
export function SelectionAnswer(props: Props) {
  const [source, setSource] = useState<SourceText | null>();

  useEffect(() => {
    readSourceText({ allowClipboard: true }).then((s) => {
      setSource(s ?? null);
      if (s?.from === "clipboard") {
        showToast({
          style: Toast.Style.Success,
          title: "No selection, using clipboard text",
        });
      }
    });
  }, []);

  if (source === undefined) return <Detail isLoading markdown="" />;
  if (source === null) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Text}
          title="No Text Found"
          description="Select text in any app or copy it to the clipboard."
        />
      </List>
    );
  }
  return (
    <AnswerView
      prompt={props.buildPrompt(source.text)}
      question={props.question(source)}
      systemPrompt={props.systemPrompt}
      navigationTitle={props.navigationTitle}
    />
  );
}
