import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  calculateCost,
  clampThinkingLevel,
  lazyStream,
  streamOpenAICodexResponses,
  streamOpenAIResponses,
  type Api,
  type TranscriptContext,
  type Model,
  type ModelThinkingLevel,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND_FAST = "fast";
const COMMAND_ULTRAFAST = "ultrafast";
const COMMAND_TIER = "openai-tier";
const FLAG_FAST = "fast";
const STATUS_KEY = "pi-openai-service-tier";
const CONFIG_BASENAME = "pi-openai-service-tier.json";

export const SERVICE_TIERS = ["priority", "flex", "default", "auto", "scale", "ultrafast"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

const OPENAI_RESPONSES_SERVICE_TIERS = SERVICE_TIERS;
const OPENAI_CODEX_RESPONSES_SERVICE_TIERS = ["priority", "ultrafast"] as const satisfies readonly ServiceTier[];

export const DEFAULT_SUPPORTED_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai/gpt-6-astra",
  "openai/gpt-6.1-sol",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
  "openai-codex/gpt-6-astra",
  "openai-codex/gpt-6.1-sol",
] as const;

export interface SupportedModel {
  provider: string;
  id: string;
}

export interface ConfigFile {
  persistState?: boolean;
  active?: boolean;
  serviceTier?: ServiceTier;
  supportedModels?: string[];
}

export interface ResolvedConfig {
  configPath: string;
  persistState: boolean;
  active: boolean;
  serviceTier: ServiceTier;
  supportedModels: SupportedModel[];
}

interface RuntimeState {
  active: boolean;
  serviceTier: ServiceTier;
}

type OpenAIServiceTierOptions = SimpleStreamOptions & {
  serviceTier?: ServiceTier;
  reasoningEffort?: ModelThinkingLevel | "none";
};

const DEFAULT_CONFIG: Required<ConfigFile> = {
  persistState: true,
  active: false,
  serviceTier: "priority",
  supportedModels: [...DEFAULT_SUPPORTED_MODELS],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isServiceTier(value: unknown): value is ServiceTier {
  return typeof value === "string" && (SERVICE_TIERS as readonly string[]).includes(value);
}

export function parseModelKey(value: string): SupportedModel | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
  const provider = trimmed.slice(0, slash).trim();
  const id = trimmed.slice(slash + 1).trim();
  return provider && id ? { provider, id } : undefined;
}

export function normalizeModelKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => parseModelKey(entry))
    .filter((entry): entry is SupportedModel => entry !== undefined)
    .map((entry) => `${entry.provider}/${entry.id}`);
}

export function parseModels(value: unknown): SupportedModel[] | undefined {
  const keys = normalizeModelKeys(value);
  if (keys === undefined) return undefined;
  return keys
    .map((key) => parseModelKey(key))
    .filter((entry): entry is SupportedModel => entry !== undefined);
}

export function configPaths(cwd: string, home = homedir()): { project: string; global: string } {
  return {
    project: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
    global: join(home, ".pi", "agent", "extensions", CONFIG_BASENAME),
  };
}

export function readConfig(path: string): ConfigFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return {};
    const config: ConfigFile = {};
    if (typeof parsed.persistState === "boolean") config.persistState = parsed.persistState;
    if (typeof parsed.active === "boolean") config.active = parsed.active;
    if (isServiceTier(parsed.serviceTier)) config.serviceTier = parsed.serviceTier;
    const supportedModels = normalizeModelKeys(parsed.supportedModels);
    if (supportedModels !== undefined) config.supportedModels = supportedModels;
    return config;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-openai-service-tier] Failed to read ${path}: ${message}`);
    return undefined;
  }
}

export function writeConfig(path: string, config: ConfigFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-openai-service-tier] Failed to write ${path}: ${message}`);
  }
}

function ensureConfigFile(projectPath: string, globalPath: string): void {
  if (existsSync(projectPath) || existsSync(globalPath)) return;
  writeConfig(globalPath, DEFAULT_CONFIG);
}

function defaultResolvedConfig(cwd: string, home = homedir()): ResolvedConfig {
  const paths = configPaths(cwd, home);
  return {
    configPath: paths.global,
    persistState: DEFAULT_CONFIG.persistState,
    active: DEFAULT_CONFIG.active,
    serviceTier: DEFAULT_CONFIG.serviceTier,
    supportedModels: parseModels(DEFAULT_SUPPORTED_MODELS) ?? [],
  };
}

export function resolveConfig(cwd: string, home = homedir()): ResolvedConfig {
  const paths = configPaths(cwd, home);
  ensureConfigFile(paths.project, paths.global);

  const projectExists = existsSync(paths.project);
  const globalConfig = readConfig(paths.global) ?? {};
  const projectConfig = readConfig(paths.project) ?? {};
  const merged: ConfigFile = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };

  return {
    configPath: projectExists ? paths.project : paths.global,
    persistState: merged.persistState ?? DEFAULT_CONFIG.persistState,
    active: merged.active ?? DEFAULT_CONFIG.active,
    serviceTier: merged.serviceTier ?? DEFAULT_CONFIG.serviceTier,
    supportedModels: parseModels(merged.supportedModels) ?? parseModels(DEFAULT_SUPPORTED_MODELS) ?? [],
  };
}

export function supportedServiceTiersForModel(
  model: Pick<Model<Api>, "api" | "id"> | undefined,
): readonly ServiceTier[] {
  if (!model) return [];
  const tiers = model.api === "openai-responses" ? OPENAI_RESPONSES_SERVICE_TIERS
    : model.api === "openai-codex-responses" ? OPENAI_CODEX_RESPONSES_SERVICE_TIERS : [];
  return model.id === "gpt-6-astra" || model.id === "gpt-6.1-sol"
    ? tiers : tiers.filter((tier) => tier !== "ultrafast");
}

export function supportsServiceTier(
  model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined,
  supportedModels: readonly SupportedModel[],
): boolean {
  if (!model) return false;
  if (supportedServiceTiersForModel(model).length === 0) return false;
  return supportedModels.some((supported) => supported.provider === model.provider && supported.id === model.id);
}

export function supportsConfiguredServiceTier(
  model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined,
  state: RuntimeState,
  supportedModels: readonly SupportedModel[],
): boolean {
  if (!supportsServiceTier(model, supportedModels)) return false;
  return supportedServiceTiersForModel(model).includes(state.serviceTier);
}

export function resolveServiceTierForModel(
  model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined,
  state: RuntimeState,
  supportedModels: readonly SupportedModel[],
): ServiceTier | undefined {
  if (!state.active || !supportsConfiguredServiceTier(model, state, supportedModels)) return undefined;
  return state.serviceTier;
}

function modelKey(model: Pick<Model<Api>, "provider" | "id"> | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function supportedModelList(models: readonly SupportedModel[]): string {
  return models.length ? models.map((model) => `${model.provider}/${model.id}`).join(", ") : "none";
}

function getConfigCwd(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function buildFullOpenAIOptions(
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  serviceTier: ServiceTier | undefined,
): OpenAIServiceTierOptions {
  const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
  const fullOptions: OpenAIServiceTierOptions = {
    ...options,
    maxTokens: options?.maxTokens ?? (model.maxTokens > 0 ? Math.min(model.maxTokens, 32_000) : undefined),
    reasoningEffort,
    ...(serviceTier ? { serviceTier } : {}),
  };
  if (model.api === "openai-responses" && serviceTier === "ultrafast") {
    // The Ultrafast API alpha requires this header in addition to service_tier.
    const headers = { ...options?.headers };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "openai-service-tier") delete headers[name];
    }
    headers["OpenAI-Service-Tier"] = "ultrafast";
    fullOptions.headers = headers;
  }
  return fullOptions;
}

function statusText(ctx: ExtensionContext, state: RuntimeState, config: ResolvedConfig): string {
  const serviceTier = resolveServiceTierForModel(ctx.model, state, config.supportedModels);
  if (serviceTier) return `${ctx.model?.id ?? "model"} ${serviceTier} requested`;
  if (state.active && supportsServiceTier(ctx.model, config.supportedModels)) {
    return `${ctx.model?.id ?? "model"} ${state.serviceTier} unsupported`;
  }
  if (state.active) return `tier requested; unsupported ${modelKey(ctx.model)}`;
  return "";
}

export default function openAIServiceTier(pi: ExtensionAPI): void {
  let sessionContext: ExtensionContext | undefined;
  let config: ResolvedConfig = defaultResolvedConfig(process.cwd());
  let state: RuntimeState = {
    active: config.active,
    serviceTier: config.serviceTier,
  };

  function refreshConfig(ctx: ExtensionContext): ResolvedConfig {
    config = resolveConfig(getConfigCwd(ctx));
    state = { active: config.active, serviceTier: config.serviceTier };
    return config;
  }

  function persistState(nextConfig: ResolvedConfig): void {
    if (!nextConfig.persistState) return;
    writeConfig(nextConfig.configPath, {
      ...(readConfig(nextConfig.configPath) ?? {}),
      active: state.active,
      serviceTier: state.serviceTier,
      supportedModels: nextConfig.supportedModels.map((model) => `${model.provider}/${model.id}`),
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(STATUS_KEY, statusText(ctx, state, config) || undefined);
  }

  function notifyStatus(ctx: ExtensionContext): void {
    const tier = resolveServiceTierForModel(ctx.model, state, config.supportedModels);
    if (tier) {
      ctx.ui.notify(`OpenAI service tier ${tier} requested for ${modelKey(ctx.model)}. Costs are API-price estimates; Codex access and subscription usage depend on your plan.${tier === "ultrafast" ? " Ultrafast API pricing is 6x Standard." : ""}`, "info");
      return;
    }
    if (state.active && supportsServiceTier(ctx.model, config.supportedModels)) {
      const supportedTiers = supportedServiceTiersForModel(ctx.model).join(", ");
      ctx.ui.notify(
        `OpenAI service tier ${state.serviceTier} is not supported by ${modelKey(ctx.model)}; no service_tier will be sent. Supported tiers: ${supportedTiers}.`,
        "warning",
      );
      return;
    }
    if (state.active) {
      ctx.ui.notify(
        `OpenAI service tier ${state.serviceTier} is on, but ${modelKey(ctx.model)} is unsupported. Supported models: ${supportedModelList(config.supportedModels)}.`,
        "warning",
      );
      return;
    }
    ctx.ui.notify(`OpenAI service tier is off. Current model: ${modelKey(ctx.model)}.`, "info");
  }

  function setActive(ctx: ExtensionContext, active: boolean): void {
    state.active = active;
    persistState(config);
    updateStatus(ctx);
    notifyStatus(ctx);
  }

  function setTier(ctx: ExtensionContext, serviceTier: ServiceTier): void {
    state = { active: true, serviceTier };
    persistState(config);
    updateStatus(ctx);
    notifyStatus(ctx);
  }

  pi.registerFlag(FLAG_FAST, {
    description: "Start with OpenAI priority service tier enabled",
    type: "boolean",
    default: false,
  });

  function streamWithTier(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
    const requestedTier = resolveServiceTierForModel(model, state, config.supportedModels);
    let returnedTier: ServiceTier | undefined;
    const fullOptions = buildFullOpenAIOptions(model, options, requestedTier);
    if (requestedTier) {
      fullOptions.onProviderStreamEvent = async (data, streamModel) => {
        if (isRecord(data) && (data.type === "response.completed" || data.type === "response.done" || data.type === "response.incomplete") && isRecord(data.response)) {
          const tier = data.response.service_tier;
          returnedTier = tier === "fast" ? "priority" : isServiceTier(tier) ? tier : undefined;
        }
        await options?.onProviderStreamEvent?.(data, streamModel);
      };
    }
    const source = model.api === "openai-responses"
      ? streamOpenAIResponses(model as Model<"openai-responses">, context, fullOptions as never)
      : streamOpenAICodexResponses(model as Model<"openai-codex-responses">, context, fullOptions as never);
    if (!requestedTier) return source;
    return lazyStream(model, async () => (async function* () {
      for await (const event of source) {
        if (event.type === "done") {
          // Codex can echo "default" for paid tiers; preserve Pi's requested-tier estimate in that case.
          const codexDefault = model.api === "openai-codex-responses" && returnedTier === "default";
          const tier = codexDefault ? requestedTier : returnedTier ?? requestedTier;
          const usage = event.message.usage;
          calculateCost(model, usage);
          let multiplier = 1;
          if (tier === "ultrafast") multiplier = 6;
          else if (tier === "priority") multiplier = model.id === "gpt-5.5" ? 2.5 : 2;
          else if (tier === "flex") multiplier = 0.5;
          for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
            usage.cost[key] *= multiplier;
          }
          if (sessionContext && state.active && state.serviceTier === requestedTier && modelKey(sessionContext.model) === modelKey(model)) {
            const status = codexDefault ? "unconfirmed (backend default)" : returnedTier ?? "unconfirmed";
            sessionContext.ui.setStatus(STATUS_KEY, `${model.id} ${status} (requested ${requestedTier})`);
          }
        }
        yield event;
      }
    })());
  }

  pi.registerProvider("openai", { api: "openai-responses", streamSimple: streamWithTier });
  pi.registerProvider("openai-codex", { api: "openai-codex-responses", streamSimple: streamWithTier });

  for (const [command, serviceTier] of [[COMMAND_FAST, "priority"], [COMMAND_ULTRAFAST, "ultrafast"]] as const) {
    pi.registerCommand(command, {
      description: `Toggle OpenAI ${serviceTier} service tier`,
      getArgumentCompletions: (prefix) => {
        const items = ["on", "off", "status"].filter((value) => value.startsWith(prefix.trim().toLowerCase()));
        return items.length ? items.map((value) => ({ value, label: value })) : null;
      },
      handler: async (args, ctx) => {
        const arg = args.trim().toLowerCase();
        if (!arg) {
          return state.active && state.serviceTier === serviceTier ? setActive(ctx, false) : setTier(ctx, serviceTier);
        }
        if (arg === "on") return setTier(ctx, serviceTier);
        if (arg === "off") return setActive(ctx, false);
        if (arg === "status") {
          updateStatus(ctx);
          return notifyStatus(ctx);
        }
        ctx.ui.notify(`Usage: /${command} [on|off|status]`, "error");
      },
    });
  }

  pi.registerCommand(COMMAND_TIER, {
    description: "Set OpenAI service tier (priority, ultrafast, flex, default, auto, scale, off, status)",
    getArgumentCompletions: (prefix) => {
      const values = [...SERVICE_TIERS, "off", "status"];
      const items = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return items.length ? items.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg || arg === "status") {
        updateStatus(ctx);
        return notifyStatus(ctx);
      }
      if (arg === "off") return setActive(ctx, false);
      if (isServiceTier(arg)) return setTier(ctx, arg);
      ctx.ui.notify("Usage: /openai-tier [priority|ultrafast|flex|default|auto|scale|off|status]", "error");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionContext = ctx;
    refreshConfig(ctx);
    if (pi.getFlag(FLAG_FAST) === true) {
      state.active = true;
      state.serviceTier = "priority";
      persistState(config);
    }
    updateStatus(ctx);
    if (state.active) notifyStatus(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    sessionContext = ctx;
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionContext = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

export const _test = {
  CONFIG_BASENAME,
  DEFAULT_CONFIG,
  COMMAND_FAST,
  COMMAND_ULTRAFAST,
  COMMAND_TIER,
  FLAG_FAST,
  STATUS_KEY,
  buildFullOpenAIOptions,
  supportedServiceTiersForModel,
  modelKey,
  statusText,
};
