import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { errorMarkdown, rateLimitLines } from "../lib/format";
import { currentModel, modelLabel, setCurrentModel } from "../lib/models";
import { useModels } from "../lib/modelCatalog";
import { newConversation, saveConversation, titleFrom } from "../lib/storage";
import { useModelStream } from "../lib/useModelStream";
import { ChatView } from "./ChatView";
import { ErrorActions, ModelSubmenu, STOP_SHORTCUT } from "./shared";

export interface AnswerViewProps {
  // Full text sent to the model (may include the selection and instructions).
  prompt: string;
  // Short form shown on screen and in history.
  question: string;
  systemPrompt?: string;
  navigationTitle?: string;
}

export function AnswerView(props: AnswerViewProps) {
  const { push } = useNavigation();
  const [model, setModel] = useState(currentModel);
  // Each run opens its own session; "Continue in Chat" resumes it with --resume.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const stream = useModelStream();
  const catalog = useModels();

  // Raycast wraps development extensions in React StrictMode, which mounts,
  // unmounts and remounts effects. Starting the request right away meant the
  // simulated unmount aborted it and a "started" guard blocked the restart, so
  // Ask showed "Stopped." Deferring the start lets that cleanup cancel the
  // timer before any CLI process is spawned.
  useEffect(() => {
    const timer = setTimeout(() => {
      stream.run({
        prompt: props.prompt,
        model,
        sessionId,
        systemPrompt: props.systemPrompt,
      });
    }, 0);
    return () => clearTimeout(timer);
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
      model,
    });
    await saveConversation(c);
    push(<ChatView initial={c} />);
  };

  const body =
    stream.error && !stream.text
      ? errorMarkdown(stream.error)
      : stream.text || "_Thinking…_";
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
                title="Duration"
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
              title="Stop"
              icon={Icon.Stop}
              shortcut={STOP_SHORTCUT}
              onAction={stream.stop}
            />
          ) : null}
          {done ? (
            <>
              <Action.Paste title="Paste to Active App" content={stream.text} />
              <Action
                title="Continue in Chat"
                icon={Icon.Bubble}
                onAction={continueInChat}
              />
              <Action.CopyToClipboard
                title="Copy Answer"
                content={stream.text}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
            </>
          ) : null}
          {stream.error ? <ErrorActions error={stream.error} /> : null}
          {!stream.isLoading ? (
            <>
              <Action
                title="Regenerate"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={() => regenerate()}
              />
              <ModelSubmenu
                title="Ask Another Model"
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
