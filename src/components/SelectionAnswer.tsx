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

// Secimi okuyup AnswerView'e verir; secim yoksa panodaki metne duser.
export function SelectionAnswer(props: Props) {
  const [source, setSource] = useState<SourceText | null>();

  useEffect(() => {
    readSourceText({ allowClipboard: true }).then((s) => {
      setSource(s ?? null);
      if (s?.from === "clipboard") {
        showToast({
          style: Toast.Style.Success,
          title: "Seçim yok, panodaki metin kullanıldı",
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
          title="Metin bulunamadı"
          description="Bir uygulamada metin seç veya panoya kopyala."
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
