import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { accessSync, constants, statSync } from "node:fs";
import { useState } from "react";
import { expandPath } from "../lib/backend/environment";
import { LANGUAGES } from "../lib/languages";
import { refreshProviderCatalog } from "../lib/modelCatalog";
import {
  browserModels,
  modelLabel,
  ModelOption,
  resolvedModel,
  sameModel,
} from "../lib/models";
import { ModelBrowser } from "./ModelBrowser";
import {
  CODEX_DEFAULT,
  PI_DEFAULT,
  Provider,
  PROVIDER_NAMES,
  providerOf,
} from "../lib/provider";
import {
  CODEX_EFFORTS,
  PI_THINKING_LEVELS,
  CodexSettings,
  Effort,
  GeneralSettings,
  ProviderSettings,
  defaultSettings,
  getSettings,
  normalizeProviderModel,
  updateGeneralSettings,
  updateProviderSettings,
} from "../lib/settings";

export function SettingsView() {
  const [settings, setSettings] = useState(getSettings);
  // Raycast can invoke onPop while rendering its navigation root.
  const reload = () => queueMicrotask(() => setSettings(getSettings()));
  return (
    <List
      navigationTitle="Cli Agent Settings"
      searchBarPlaceholder="Search settings"
    >
      <List.Section title="General">
        <List.Item
          title="General"
          subtitle="Default agent, languages and instructions"
          icon={Icon.Gear}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open General Settings"
                target={<GeneralSettingsForm />}
                onPop={reload}
              />
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Providers">
        {(["codex", "pi"] as const).map((provider) => (
          <List.Item
            key={provider}
            title={PROVIDER_NAMES[provider]}
            subtitle={
              provider === "codex"
                ? "Setup, models, responses and environment"
                : "Setup, models, thinking and environment"
            }
            icon={Icon.Terminal}
            accessories={[
              {
                text: settings.providers[provider].enabled
                  ? "Enabled"
                  : "Disabled",
              },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title={`Open ${PROVIDER_NAMES[provider]} Settings`}
                  target={<ProviderSettingsForm provider={provider} />}
                  onPop={reload}
                />
                <Action.Push
                  title="Open Model Browser"
                  target={<ModelBrowser provider={provider} />}
                  onPop={reload}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

function GeneralSettingsForm() {
  const { pop } = useNavigation();
  const [values, setValues] = useState(() => getSettings().general);
  const [saveError, setSaveError] = useState("");
  const enabled = getSettings().providers;
  const set = <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K],
  ) => {
    const next = { ...values, [key]: value };
    setValues(next);
    try {
      updateGeneralSettings(next);
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };
  const save = async () => {
    try {
      updateGeneralSettings(values);
      await showToast({
        style: Toast.Style.Success,
        title: "General settings saved",
      });
      pop();
    } catch (error) {
      await reportError(error);
    }
  };
  return (
    <Form
      navigationTitle="General Settings"
      actions={
        <ActionPanel>
          <Action
            title="Save Settings"
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={save}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="General"
        text="Changes save automatically. New chats use the default agent; existing chats keep their agent."
      />
      {saveError ? (
        <Form.Description title="Not Saved" text={saveError} />
      ) : null}
      <Form.Dropdown
        id="defaultProvider"
        title="Default Agent"
        value={values.defaultProvider}
        onChange={(value) => set("defaultProvider", value as Provider)}
      >
        {(["codex", "pi"] as const)
          .filter((p) => enabled[p].enabled)
          .map((p) => (
            <Form.Dropdown.Item key={p} value={p} title={PROVIDER_NAMES[p]} />
          ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="primaryLanguage"
        title="Primary Language"
        value={values.primaryLanguage}
        onChange={(value) => set("primaryLanguage", value)}
      >
        {LANGUAGES.map((l) => (
          <Form.Dropdown.Item key={l.name} value={l.name} title={l.name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="secondaryLanguage"
        title="Secondary Language"
        value={values.secondaryLanguage}
        onChange={(value) => set("secondaryLanguage", value)}
      >
        {LANGUAGES.map((l) => (
          <Form.Dropdown.Item key={l.name} value={l.name} title={l.name} />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="extraInstructions"
        title="Extra Instructions"
        value={values.extraInstructions}
        onChange={(value) => set("extraInstructions", value)}
        placeholder="Tone, language preferences and other instructions for both agents"
      />
    </Form>
  );
}

type ProviderDraft = ProviderSettings &
  Pick<
    CodexSettings,
    | "effort"
    | "webSearch"
    | "responseStyle"
    | "responseVerbosity"
    | "reasoningSummary"
  > & {
    thinkingLevel: Effort | "";
    customModelsText: string;
    aliasesText: string;
    thinkingByModelText: string;
  };

function assignments(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line, index) => {
        const separator = line.indexOf("=");
        if (separator <= 0)
          throw new Error(
            `Invalid entry on line ${index + 1}. Use model-id=value.`,
          );
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim(),
        ];
      }),
  );
}

function mapText(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function initialDraft(provider: Provider): ProviderDraft {
  const settings = getSettings();
  const value = settings.providers[provider];
  return {
    ...defaultSettings().providers.codex,
    thinkingLevel: "",
    ...value,
    customModelsText: value.customModels.join("\n"),
    aliasesText: mapText(value.modelAliases),
    thinkingByModelText:
      provider === "pi"
        ? mapText(settings.providers.pi.preferredThinkingByModel)
        : "",
  };
}

function ProviderSettingsForm({ provider }: { provider: Provider }) {
  const { pop } = useNavigation();
  const [draft, setDraft] = useState(() => initialDraft(provider));
  const [models, setModels] = useState(() => browserModels(provider));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = <K extends keyof ProviderDraft>(
    key: K,
    value: ProviderDraft[K],
  ) => {
    const next = { ...draft, [key]: value };
    if (
      key === "visibleModels" &&
      next.visibleModels !== null &&
      !next.visibleModels.some((id) => sameModel(id, next.defaultModel))
    )
      next.defaultModel =
        next.visibleModels[0] ??
        (provider === "codex" ? CODEX_DEFAULT : PI_DEFAULT);
    if (key === "defaultModel") {
      const actual = resolvedModel(next.defaultModel);
      if (browserModels(provider).some((m) => m.value === actual))
        next.visibleModels = [
          actual,
          ...(next.visibleModels ?? []).filter((id) => id !== actual),
        ];
    }
    setDraft(next);
    try {
      persist(next);
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };
  const nativeDefault = provider === "codex" ? CODEX_DEFAULT : PI_DEFAULT;
  const choices = models.filter(
    (model) =>
      providerOf(model.value) === provider && model.value !== nativeDefault,
  );
  for (const raw of [
    nativeDefault,
    ...(provider === "codex" ? draft.customModelsText.split(/[\n,]/) : []),
  ]) {
    try {
      const value = normalizeProviderModel(provider, raw);
      if (!choices.some((m) => m.value === value))
        choices.push({
          value,
          title:
            value === nativeDefault
              ? "Follow CLI Configuration"
              : modelLabel(value),
        });
    } catch {
      /* Incomplete model input is validated on save. */
    }
  }
  const persist = (value = draft) => {
    if (value.cliPath.trim()) {
      const path = expandPath(value.cliPath.trim());
      try {
        accessSync(path, constants.X_OK);
        if (!statSync(path).isFile()) throw new Error();
      } catch {
        throw new Error(
          "CLI Path must point to an executable file, or be left empty for discovery.",
        );
      }
    }
    const common: ProviderSettings = {
      enabled: value.enabled,
      cliPath: value.cliPath,
      configDir: value.configDir,
      environmentVariables: value.environmentVariables,
      defaultModel: value.defaultModel,
      customModels: value.customModelsText
        .split(/[\n,]/)
        .map((m) => m.trim())
        .filter(Boolean),
      visibleModels: value.visibleModels,
      modelAliases: assignments(value.aliasesText),
      tools: value.tools,
    };
    if (provider === "codex")
      updateProviderSettings("codex", {
        ...common,
        effort: value.effort,
        webSearch: value.webSearch,
        responseStyle: value.responseStyle,
        responseVerbosity: value.responseVerbosity,
        reasoningSummary: value.reasoningSummary,
      });
    else
      updateProviderSettings("pi", {
        ...common,
        thinkingLevel: value.thinkingLevel,
        preferredThinkingByModel: assignments(
          value.thinkingByModelText,
        ) as Record<string, Effort>,
      });
  };
  const save = async () => {
    try {
      persist();
      await showToast({
        style: Toast.Style.Success,
        title: `${PROVIDER_NAMES[provider]} settings saved`,
      });
      pop();
    } catch (error) {
      await reportError(error);
    }
  };
  const discover = async () => {
    setBusy(true);
    try {
      if (!draft.enabled)
        throw new Error("Enable this provider before discovering its models.");
      persist();
      const catalog = await refreshProviderCatalog(provider);
      setModels(browserModels(provider));
      setDraft(initialDraft(provider));
      await showToast({
        style: Toast.Style.Success,
        title: "Models refreshed",
        message: `${catalog.models.filter((m) => providerOf(m.value) === provider).length} ${PROVIDER_NAMES[provider]} models`,
      });
    } catch (error) {
      await reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const reasoningChoices =
    provider === "codex" ? CODEX_EFFORTS : PI_THINKING_LEVELS;
  return (
    <Form
      navigationTitle={`${PROVIDER_NAMES[provider]} Settings`}
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action
            title="Save Settings"
            shortcut={Keyboard.Shortcut.Common.Save}
            onAction={save}
          />
          <Action
            title="Save and Discover Models"
            icon={Icon.ArrowClockwise}
            onAction={discover}
          />
          <Action.Push
            title="Model Browser"
            icon={Icon.MagnifyingGlass}
            shortcut={{ modifiers: ["cmd"], key: "b" }}
            target={<ModelBrowser provider={provider} />}
            onPop={() =>
              queueMicrotask(() => {
                setDraft(initialDraft(provider));
                setModels(browserModels(provider));
              })
            }
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Setup"
        text={`Valid changes save automatically for ${PROVIDER_NAMES[provider]}. Existing CLI authentication and configuration are reused.`}
      />
      {saveError ? (
        <Form.Description title="Not Saved" text={saveError} />
      ) : null}
      <Form.Checkbox
        id="enabled"
        label={`Enable ${PROVIDER_NAMES[provider]}`}
        value={draft.enabled}
        onChange={(value) => set("enabled", value)}
      />
      <Form.TextField
        id="cliPath"
        title="CLI Path"
        placeholder={`/opt/homebrew/bin/${provider} (empty to discover)`}
        value={draft.cliPath}
        onChange={(value) => set("cliPath", value)}
      />
      <Form.TextField
        id="configDir"
        title="Configuration Directory"
        placeholder={
          provider === "codex"
            ? "CODEX_HOME or ~/.codex"
            : "PI_CODING_AGENT_DIR or ~/.pi/agent"
        }
        value={draft.configDir}
        onChange={(value) => set("configDir", value)}
      />
      <Form.Separator />
      <Form.Description
        title="Model Browser"
        text="Open Model Browser (⌘B) to discover models and choose which appear in chats. Pi authentication is checked by Pi itself. Valid selections save automatically."
      />
      <Form.Dropdown
        id="defaultModel"
        title="Default Model"
        value={draft.defaultModel}
        onChange={(value) => set("defaultModel", value)}
      >
        {choices.map((model: ModelOption) => (
          <Form.Dropdown.Item
            key={model.value}
            title={
              model.value === nativeDefault
                ? "Follow CLI Configuration"
                : modelLabel(model.value)
            }
            value={model.value}
          />
        ))}
      </Form.Dropdown>
      {provider === "codex" ? (
        <Form.TextArea
          id="customModels"
          title="Extra Models"
          placeholder={
            provider === "codex"
              ? "my-model\ncodex:another-model"
              : "openai/my-model\npi:anthropic/another-model"
          }
          value={draft.customModelsText}
          onChange={(value) => set("customModelsText", value)}
        />
      ) : null}
      <Form.Description
        title="Visible Models"
        text="Only these discovered models appear in chats. Clearing this list hides all models for this agent. Model discovery does not add new models to an existing selection."
      />
      <Form.TagPicker
        id="visibleModels"
        title="Visible Models"
        value={draft.visibleModels ?? []}
        onChange={(value) => set("visibleModels", value)}
      >
        {choices
          .filter((model) => model.value !== nativeDefault)
          .map((model) => (
            <Form.TagPicker.Item
              key={model.value}
              title={
                model.value === nativeDefault
                  ? "Follow CLI Configuration"
                  : modelLabel(model.value)
              }
              value={model.value}
            />
          ))}
      </Form.TagPicker>
      <Form.TextArea
        id="modelAliases"
        title="Model Aliases"
        placeholder="model-id=Display name"
        value={draft.aliasesText}
        onChange={(value) => set("aliasesText", value)}
      />
      <Form.Separator />
      <Form.Description
        title={provider === "codex" ? "Responses" : "Thinking"}
        text="CLI Default preserves the native setting. Supported levels depend on the selected model."
      />
      <Form.Dropdown
        id="reasoning"
        title={provider === "codex" ? "Reasoning Effort" : "Thinking Level"}
        value={provider === "codex" ? draft.effort : draft.thinkingLevel}
        onChange={(value) =>
          provider === "codex"
            ? set("effort", value as Effort | "")
            : set("thinkingLevel", value as Effort | "")
        }
      >
        <Form.Dropdown.Item value="" title="CLI Default" />
        {reasoningChoices.map((level) => (
          <Form.Dropdown.Item
            key={level}
            value={level}
            title={
              level === "xhigh"
                ? "Extra High"
                : level[0].toUpperCase() + level.slice(1)
            }
          />
        ))}
      </Form.Dropdown>
      {provider === "codex" ? (
        <>
          <Form.Dropdown
            id="responseStyle"
            title="Response Style"
            value={draft.responseStyle}
            onChange={(value) =>
              set("responseStyle", value as CodexSettings["responseStyle"])
            }
          >
            {[
              ["default", "CLI Default"],
              ["pragmatic", "Pragmatic"],
              ["friendly", "Friendly"],
              ["none", "Neutral"],
            ].map(([value, title]) => (
              <Form.Dropdown.Item key={value} value={value} title={title} />
            ))}
          </Form.Dropdown>
          <Form.Dropdown
            id="responseVerbosity"
            title="Response Verbosity"
            value={draft.responseVerbosity}
            onChange={(value) =>
              set(
                "responseVerbosity",
                value as CodexSettings["responseVerbosity"],
              )
            }
          >
            {[
              ["default", "CLI Default"],
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
            ].map(([value, title]) => (
              <Form.Dropdown.Item key={value} value={value} title={title} />
            ))}
          </Form.Dropdown>
          <Form.Dropdown
            id="reasoningSummary"
            title="Reasoning Summary"
            value={draft.reasoningSummary}
            onChange={(value) =>
              set(
                "reasoningSummary",
                value as CodexSettings["reasoningSummary"],
              )
            }
          >
            {[
              ["default", "CLI Default"],
              ["auto", "Auto"],
              ["concise", "Concise"],
              ["detailed", "Detailed"],
              ["none", "Off"],
            ].map(([value, title]) => (
              <Form.Dropdown.Item key={value} value={value} title={title} />
            ))}
          </Form.Dropdown>
          <Form.Checkbox
            id="webSearch"
            label="Enable web search by default"
            value={draft.webSearch}
            onChange={(value) => set("webSearch", value)}
          />
        </>
      ) : (
        <Form.TextArea
          id="thinkingByModel"
          title="Thinking by Model"
          placeholder="pi:openai/model-id=high"
          value={draft.thinkingByModelText}
          onChange={(value) => set("thinkingByModelText", value)}
        />
      )}
      <Form.Checkbox
        id="tools"
        label="Enable read-only file tools and reviewed shell commands by default"
        value={draft.tools}
        onChange={(value) => set("tools", value)}
      />
      <Form.Separator />
      <Form.Description
        title="Environment"
        text="Optional overrides for this provider only, one KEY=value per line. Values are passed literally and stored locally with private file permissions."
      />
      <Form.TextArea
        id="environmentVariables"
        title="Environment Variables"
        value={draft.environmentVariables}
        onChange={(value) => set("environmentVariables", value)}
        placeholder={
          provider === "codex"
            ? "HTTPS_PROXY=http://127.0.0.1:7890"
            : "PI_CODING_AGENT_DIR=/path/to/pi/agent"
        }
      />
    </Form>
  );
}

async function reportError(error: unknown) {
  await showToast({
    style: Toast.Style.Failure,
    title: "Settings could not be applied",
    message: error instanceof Error ? error.message : String(error),
  });
}
