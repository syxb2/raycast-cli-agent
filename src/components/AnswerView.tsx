import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { errorMarkdown, rateLimitLines } from "../lib/format";
import { currentModel, modelLabel, setCurrentModel } from "../lib/models";
import { useModels } from "../lib/modelCatalog";
import { newConversation, saveConversation, titleFrom } from "../lib/storage";
import { useClaudeStream } from "../lib/useClaudeStream";
import { ChatView } from "./ChatView";
import { ErrorActions, ModelSubmenu, STOP_SHORTCUT } from "./shared";

export interface AnswerViewProps {
  // Modele giden tam metin (secim + talimat olabilir).
  prompt: string;
  // Ekranda ve gecmiste gorunen kisa hali.
  question: string;
  systemPrompt?: string;
  navigationTitle?: string;
}

export function AnswerView(props: AnswerViewProps) {
  const { push } = useNavigation();
  const [model, setModel] = useState(currentModel);
  // Her calistirma kendi oturumunu acar; "Sohbette Devam Et" bu oturumu --resume eder.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const stream = useClaudeStream();
  const catalog = useModels();
  const started = useRef("");

  useEffect(() => {
    const key = `${sessionId}:${model}`;
    if (started.current === key) return;
    started.current = key;
    stream.run({
      prompt: props.prompt,
      model,
      sessionId,
      systemPrompt: props.systemPrompt,
    });
  }, [sessionId, model]);

  const regenerate = (m = model) => {
    setCurrentModel(m);
    setModel(m);
    setSessionId(crypto.randomUUID());
  };

  const continueInChat = async () => {
    const c = newConversation(model);
    c.sessionId = sessionId;
    c.title = titleFrom(props.question);
    c.messages.push({
      id: crypto.randomUUID(),
      question: props.question,
      answer: stream.text,
      createdAt: Date.now(),
    });
    await saveConversation(c);
    push(<ChatView initial={c} />);
  };

  const body =
    stream.error && !stream.text
      ? errorMarkdown(stream.error)
      : stream.text || "_Claude düşünüyor…_";
  const markdown = `**${escape(props.question)}**\n\n---\n\n${body}`;
  const done = !stream.isLoading && !stream.error && stream.text.length > 0;

  return (
    <Detail
      navigationTitle={props.navigationTitle ?? "CLI Assistant"}
      isLoading={stream.isLoading}
      markdown={markdown}
      metadata={
        !stream.isLoading ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Model" text={modelLabel(model)} />
            {stream.durationMs ? (
              <Detail.Metadata.Label
                title="Süre"
                text={`${(stream.durationMs / 1000).toFixed(1)} sn`}
              />
            ) : null}
            {rateLimitLines(stream.rateLimit).map((l) => (
              <Detail.Metadata.Label
                key={l.title}
                title={l.title}
                text={l.text}
              />
            ))}
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {stream.isLoading ? (
            <Action
              title="Durdur"
              icon={Icon.Stop}
              shortcut={STOP_SHORTCUT}
              onAction={stream.stop}
            />
          ) : null}
          {done ? (
            <>
              <Action.Paste
                title="Ön Uygulamaya Yapıştır"
                content={stream.text}
              />
              <Action
                title="Sohbette Devam Et"
                icon={Icon.Bubble}
                onAction={continueInChat}
              />
              <Action.CopyToClipboard
                title="Kopyala"
                content={stream.text}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
            </>
          ) : null}
          {stream.error ? <ErrorActions error={stream.error} /> : null}
          {!stream.isLoading ? (
            <>
              <Action
                title="Yeniden Üret"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={() => regenerate()}
              />
              <ModelSubmenu
                title="Başka Modelle Sor"
                current={model}
                models={catalog.models}
                onSelect={regenerate}
                onRefresh={() => catalog.refresh(true)}
              />
            </>
          ) : null}
        </ActionPanel>
      }
    />
  );
}

// Soru basliginda Markdown ozel karakterleri bicimi bozmasin.
function escape(s: string): string {
  const oneLine = s.length > 300 ? `${s.slice(0, 297)}…` : s;
  return oneLine.replace(/([\\`*_[\]#>])/g, "\\$1").replace(/\n+/g, " ");
}
