import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  LocalStorage,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { ModelSubmenu } from "./components/shared";
import { errorMarkdown } from "./lib/format";
import {
  AUTO,
  autoLabel,
  LANGUAGES,
  isWrongLanguage,
  resolveTranslation,
  RETRY_MODEL,
} from "./lib/languages";
import { useModels } from "./lib/modelCatalog";
import { currentModel, modelLabel, setCurrentModel } from "./lib/models";
import { translateSystemPrompt, translationPrompt } from "./lib/prompts";
import { readSourceText } from "./lib/selection";
import { useClaudeStream } from "./lib/useClaudeStream";

// Like Raycast's Translate: the search bar is the input and translation starts
// when typing pauses. Each request takes ~3 s, so keystrokes are debounced
// into a single request.
const DEBOUNCE_MS = 600;
const LANG_KEY = "translate-language";

export default function Command() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<string>();
  const [ready, setReady] = useState(false);
  const [model, setModel] = useState(currentModel);
  const stream = useClaudeStream();
  const catalog = useModels();
  const lastRequest = useRef("");
  const [retriedWith, setRetriedWith] = useState<string>();

  useEffect(() => {
    Promise.all([
      readSourceText({ allowClipboard: false }),
      LocalStorage.getItem<string>(LANG_KEY),
    ]).then(([source, lang]) => {
      if (source) setText(source.text);
      setLanguage(
        lang && (lang === AUTO || LANGUAGES.some((l) => l.name === lang))
          ? lang
          : AUTO,
      );
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready || !language) return;
    const input = text.trim();
    if (!input) {
      stream.stop();
      return;
    }
    const key = `${model}:${language}:${input}`;
    if (key === lastRequest.current) return;
    const t = setTimeout(async () => {
      lastRequest.current = key;
      setRetriedWith(undefined);
      const direction = resolveTranslation(input, language);
      const request = {
        prompt: translationPrompt(input),
        systemPrompt: translateSystemPrompt(direction),
      };
      const result = await stream.run({ ...request, model });
      // One retry with a stronger model if the output is in the wrong language.
      if (
        lastRequest.current === key &&
        !result.isError &&
        model !== RETRY_MODEL &&
        isWrongLanguage(result.text, direction.target)
      ) {
        setRetriedWith(RETRY_MODEL);
        await stream.run({ ...request, model: RETRY_MODEL });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, language, model, ready]);

  const changeModel = (value: string) => {
    setCurrentModel(value);
    setModel(value);
  };

  const changeLanguage = (value: string) => {
    setLanguage(value);
    LocalStorage.setItem(LANG_KEY, value);
  };

  const translation = stream.text.trim();
  const hasInput = text.trim().length > 0;
  const target =
    hasInput && language ? resolveTranslation(text, language).target : "";
  const markdown =
    stream.error && !translation
      ? errorMarkdown(stream.error)
      : translation || "_Translating…_";

  return (
    <List
      isLoading={!ready || stream.isLoading}
      searchText={text}
      onSearchTextChange={setText}
      searchBarPlaceholder="Type or paste text to translate"
      filtering={false}
      isShowingDetail={hasInput}
      searchBarAccessory={
        language ? (
          <List.Dropdown
            tooltip="Target Language"
            value={language}
            onChange={changeLanguage}
          >
            <List.Dropdown.Item title={autoLabel()} value={AUTO} />
            <List.Dropdown.Section>
              {LANGUAGES.map((l) => (
                <List.Dropdown.Item
                  key={l.name}
                  title={l.name}
                  value={l.name}
                />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : undefined
      }
    >
      {!hasInput ? (
        <List.EmptyView
          icon={Icon.Globe}
          title="Type Text to Translate"
          description="Selected text is filled in automatically"
        />
      ) : (
        <List.Item
          title={`→ ${target}`}
          subtitle={
            retriedWith
              ? `${modelLabel(retriedWith)} (retried: wrong language)`
              : modelLabel(model)
          }
          icon={Icon.Globe}
          detail={<List.Item.Detail markdown={markdown} />}
          actions={
            <ActionPanel>
              {translation ? (
                <>
                  <Action.Paste
                    title="Paste to Active App"
                    content={translation}
                  />
                  <Action.CopyToClipboard
                    title="Copy Translation"
                    content={translation}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                  {language === AUTO ? (
                    <Action
                      title="Translate Back"
                      icon={Icon.Switch}
                      shortcut={{ modifiers: ["cmd"], key: "t" }}
                      onAction={() => setText(translation)}
                    />
                  ) : null}
                </>
              ) : null}
              <ModelSubmenu
                title="Change Model"
                current={model}
                models={catalog.models}
                onSelect={changeModel}
                onRefresh={() => catalog.refresh(true)}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
