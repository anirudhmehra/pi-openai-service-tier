import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import openAIServiceTier, {
  DEFAULT_SUPPORTED_MODELS,
  _test,
  configPaths,
  isServiceTier,
  parseModelKey,
  parseModels,
  readConfig,
  writeConfig,
  resolveConfig,
  resolveServiceTierForModel,
  supportedServiceTiersForModel,
  supportsConfiguredServiceTier,
  supportsServiceTier,
  type ServiceTier,
} from "./index.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-openai-service-tier-"));
}

const openAIModel = {
  provider: "openai",
  id: "gpt-5.5",
  api: "openai-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

const codexModel = {
  provider: "openai-codex",
  id: "gpt-5.5",
  api: "openai-codex-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

const codex56Model = {
  provider: "openai-codex",
  id: "gpt-5.6-sol",
  api: "openai-codex-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

test("recognizes supported service tiers", () => {
  assert.equal(isServiceTier("priority"), true);
  assert.equal(isServiceTier("flex"), true);
  assert.equal(isServiceTier("default"), true);
  assert.equal(isServiceTier("auto"), true);
  assert.equal(isServiceTier("scale"), true);
  assert.equal(isServiceTier("fast"), false);
});

test("parses provider/model keys", () => {
  assert.deepEqual(parseModelKey("openai/gpt-5.5"), { provider: "openai", id: "gpt-5.5" });
  assert.equal(parseModelKey("openai"), undefined);
  assert.deepEqual(parseModels(["openai/gpt-5.5", "bad", 123]), [{ provider: "openai", id: "gpt-5.5" }]);
});

test("resolves project config over global config", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    mkdirSync(dirname(paths.project), { recursive: true });
    writeFileSync(paths.global, JSON.stringify({ active: false, serviceTier: "flex" }), "utf8");
    writeFileSync(paths.project, JSON.stringify({ active: true, serviceTier: "priority" }), "utf8");

    const config = resolveConfig(cwd, home);
    assert.equal(config.configPath, paths.project);
    assert.equal(config.active, true);
    assert.equal(config.serviceTier, "priority");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("ignores malformed config and invalid service tiers", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    writeFileSync(paths.global, "{ bad json", "utf8");
    assert.equal(readConfig(paths.global), undefined);

    writeFileSync(paths.global, JSON.stringify({ active: true, serviceTier: "turbo" }), "utf8");
    const config = resolveConfig(cwd, home);
    assert.equal(config.active, true);
    assert.equal(config.serviceTier, "priority");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("knows provider-specific service tier support", () => {
  assert.deepEqual([...supportedServiceTiersForModel(openAIModel)], ["priority", "flex", "default", "auto", "scale"]);
  assert.deepEqual([...supportedServiceTiersForModel(codexModel)], ["priority"]);
});

test("includes every GPT-5.6 variant for OpenAI and OpenAI Codex", () => {
  const defaults = new Set<string>(DEFAULT_SUPPORTED_MODELS);
  for (const provider of ["openai", "openai-codex"]) {
    for (const id of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
      assert.equal(defaults.has(`${provider}/${id}`), true);
    }
  }
});

test("supports all verified GPT-6 models on OpenAI and OpenAI Codex", () => {
  const supportedModels = parseModels(DEFAULT_SUPPORTED_MODELS) ?? [];
  const models = ["openai", "openai-codex"].flatMap((provider) =>
    ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"].map((id) => ({ provider, id })),
  );
  for (const { provider, id } of models) {
    const model = {
      provider,
      id,
      api: provider === "openai" ? "openai-responses" : "openai-codex-responses",
    };
    assert.equal(supportsServiceTier(model, supportedModels), true);
    assert.equal(
      resolveServiceTierForModel(model, { active: true, serviceTier: "priority" }, supportedModels),
      "priority",
    );
    assert.equal(
      resolveServiceTierForModel(model, { active: false, serviceTier: "priority" }, supportedModels),
      undefined,
    );
    assert.equal(
      resolveServiceTierForModel(model, { active: true, serviceTier: "priority" }, []),
      undefined,
    );
    assert.equal(
      resolveServiceTierForModel(model, { active: true, serviceTier: "flex" }, supportedModels),
      provider === "openai" ? "flex" : undefined,
    );
  }
});

test("unknown versions require explicit opt-in, including dated snapshots", () => {
  const defaults = parseModels(DEFAULT_SUPPORTED_MODELS) ?? [];
  for (const provider of ["openai", "openai-codex"]) {
    for (const id of ["gpt-6-sol-2099-01-01", "gpt-7-sol"]) {
      const model = {
        provider,
        id,
        api: provider === "openai" ? "openai-responses" : "openai-codex-responses",
      };
      const state = { active: true, serviceTier: "priority" } as const;
      assert.equal(resolveServiceTierForModel(model, state, defaults), undefined);
      assert.equal(resolveServiceTierForModel(model, state, [...defaults, { provider, id }]), "priority");
    }
  }
});

test("applies configured tier only when active, allow-listed, and tier-supported", () => {
  const supportedModels = parseModels(DEFAULT_SUPPORTED_MODELS) ?? [];
  assert.equal(supportsServiceTier(openAIModel, supportedModels), true);
  assert.equal(supportsServiceTier(codexModel, supportedModels), true);
  assert.equal(supportsServiceTier(codex56Model, supportedModels), true);
  assert.equal(
    resolveServiceTierForModel(openAIModel, { active: true, serviceTier: "priority" satisfies ServiceTier }, supportedModels),
    "priority",
  );
  assert.equal(
    resolveServiceTierForModel(openAIModel, { active: false, serviceTier: "priority" }, supportedModels),
    undefined,
  );
  assert.equal(
    supportsConfiguredServiceTier(codexModel, { active: true, serviceTier: "flex" }, supportedModels),
    false,
  );
  assert.equal(
    resolveServiceTierForModel(codexModel, { active: true, serviceTier: "flex" }, supportedModels),
    undefined,
  );
  assert.equal(
    resolveServiceTierForModel(
      { provider: "openai", id: "gpt-4.1", api: "openai-responses" } as never,
      { active: true, serviceTier: "priority" },
      supportedModels,
    ),
    undefined,
  );
  assert.equal(
    resolveServiceTierForModel(
      { provider: "openai", id: "gpt-5.5", api: "openai-completions" } as never,
      { active: true, serviceTier: "priority" },
      supportedModels,
    ),
    undefined,
  );
});

test("full provider options include serviceTier for Pi cost accounting", () => {
  const options = _test.buildFullOpenAIOptions(openAIModel, { reasoning: "high" }, "priority");
  assert.equal(options.serviceTier, "priority");
  assert.equal(options.maxTokens, 32000);
  assert.equal(options.reasoningEffort, "high");
});

test("resolveConfig creates a default config without freezing the package model defaults", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    const config = resolveConfig(cwd, home);
    const persisted = JSON.parse(readFileSync(paths.global, "utf8")) as Record<string, unknown>;

    assert.equal(existsSync(paths.global), true);
    assert.equal(config.active, false);
    assert.equal(config.serviceTier, "priority");
    assert.equal(config.supportedModels.some((model) => model.provider === "openai" && model.id === "gpt-5.6-sol"), true);
    for (const provider of ["openai", "openai-codex"]) {
      assert.equal(config.supportedModels.some((model) => model.provider === provider && model.id === "gpt-6-astra"), true);
    }
    assert.equal(Object.hasOwn(persisted, "supportedModels"), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("migrates the generated 0.1.x allow-list to package-maintained defaults", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    writeFileSync(
      paths.global,
      JSON.stringify({
        active: true,
        serviceTier: "priority",
        supportedModels: [
          "openai/gpt-5.4",
          "openai/gpt-5.5",
          "openai-codex/gpt-5.4",
          "openai-codex/gpt-5.5",
        ],
      }),
      "utf8",
    );

    const config = resolveConfig(cwd, home);
    const persisted = JSON.parse(readFileSync(paths.global, "utf8")) as Record<string, unknown>;

    assert.equal(config.supportedModels.some((model) => model.id === "gpt-5.6-sol"), true);
    for (const provider of ["openai", "openai-codex"]) {
      assert.equal(config.supportedModels.some((model) => model.provider === provider && model.id === "gpt-6-astra"), true);
    }
    assert.equal(Object.hasOwn(persisted, "supportedModels"), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("preserves a custom model allow-list", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    writeFileSync(paths.global, JSON.stringify({ supportedModels: ["openai/gpt-5.6-sol"] }), "utf8");

    const config = resolveConfig(cwd, home);
    const persisted = JSON.parse(readFileSync(paths.global, "utf8")) as { supportedModels?: string[] };

    assert.deepEqual(config.supportedModels, [{ provider: "openai", id: "gpt-5.6-sol" }]);
    assert.deepEqual(persisted.supportedModels, ["openai/gpt-5.6-sol"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("additional models extend defaults, normalize keys, and deduplicate without freezing defaults", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const { global } = configPaths(cwd, home);
    mkdirSync(dirname(global), { recursive: true });
    const additionalSupportedModels = [" openai / future-model ", "openai/future-model", "openai/gpt-6-astra", "bad", 123];
    writeFileSync(global, JSON.stringify({ additionalSupportedModels }));
    const config = resolveConfig(cwd, home);
    assert.deepEqual(config.supportedModels, [
      ...(parseModels(DEFAULT_SUPPORTED_MODELS) ?? []),
      { provider: "openai", id: "future-model" },
    ]);
    assert.equal(resolveServiceTierForModel(
      { provider: "openai", id: "future-model", api: "openai-responses" },
      { active: true, serviceTier: "priority" },
      config.supportedModels,
    ), "priority");
    assert.deepEqual(JSON.parse(readFileSync(global, "utf8")), { additionalSupportedModels });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("additional models respect custom bases and project-over-global precedence", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    mkdirSync(dirname(paths.project), { recursive: true });
    writeFileSync(paths.global, JSON.stringify({
      supportedModels: ["openai/custom-base"],
      additionalSupportedModels: ["openai/global-extra"],
    }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, parseModels(["openai/custom-base", "openai/global-extra"]));
    writeFileSync(paths.project, JSON.stringify({ additionalSupportedModels: ["openai/project-extra"] }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, parseModels(["openai/custom-base", "openai/project-extra"]));
    writeFileSync(paths.project, JSON.stringify({ additionalSupportedModels: [] }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, parseModels(["openai/custom-base"]));
    writeFileSync(paths.project, JSON.stringify({ supportedModels: [], additionalSupportedModels: [] }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, []);
    writeFileSync(paths.project, JSON.stringify({ supportedModels: [], additionalSupportedModels: ["openai/only-extra"] }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, parseModels(["openai/only-extra"]));
    writeFileSync(paths.project, JSON.stringify({ additionalSupportedModels: "invalid" }));
    assert.deepEqual(resolveConfig(cwd, home).supportedModels, parseModels(["openai/custom-base", "openai/global-extra"]));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("legacy migration and config writes preserve additional models", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const { global } = configPaths(cwd, home);
    mkdirSync(dirname(global), { recursive: true });
    writeFileSync(global, JSON.stringify({
      active: true,
      supportedModels: ["openai/gpt-5.4", "openai/gpt-5.5", "openai-codex/gpt-5.4", "openai-codex/gpt-5.5"],
      additionalSupportedModels: ["openai/future-model"],
    }));
    const config = resolveConfig(cwd, home);
    assert.deepEqual(config.supportedModels, [
      ...(parseModels(DEFAULT_SUPPORTED_MODELS) ?? []),
      { provider: "openai", id: "future-model" },
    ]);
    assert.deepEqual(readConfig(global), { active: true, additionalSupportedModels: ["openai/future-model"] });
    writeConfig(global, { ...readConfig(global), active: false, serviceTier: "priority" });
    assert.deepEqual(readConfig(global)?.additionalSupportedModels, ["openai/future-model"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("overrides the built-in providers without replacing their dynamic model catalogs", () => {
  const providers = new Map<string, { api?: string; models?: unknown }>();
  openAIServiceTier({
    registerFlag() {},
    registerProvider(name: string, config: { api?: string; models?: unknown }) {
      providers.set(name, config);
    },
    registerCommand() {},
    on() {},
  } as never);

  assert.deepEqual([...providers.keys()], ["openai", "openai-codex"]);
  assert.equal(providers.get("openai")?.api, "openai-responses");
  assert.equal(providers.get("openai-codex")?.api, "openai-codex-responses");
  assert.equal(Object.hasOwn(providers.get("openai") ?? {}, "models"), false);
  assert.equal(Object.hasOwn(providers.get("openai-codex") ?? {}, "models"), false);
});
