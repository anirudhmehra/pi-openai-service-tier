import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_SUPPORTED_MODELS,
  _test,
  configPaths,
  isServiceTier,
  parseModelKey,
  parseModels,
  readConfig,
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

test("recognizes supported service tiers", () => {
  assert.equal(isServiceTier("priority"), true);
  assert.equal(isServiceTier("flex"), true);
  assert.equal(isServiceTier("default"), true);
  assert.equal(isServiceTier("auto"), true);
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
  assert.deepEqual([...supportedServiceTiersForModel(openAIModel)], ["priority", "flex", "default", "auto"]);
  assert.deepEqual([...supportedServiceTiersForModel(codexModel)], ["priority"]);
});

test("applies configured tier only when active, allow-listed, and tier-supported", () => {
  const supportedModels = parseModels(DEFAULT_SUPPORTED_MODELS) ?? [];
  assert.equal(supportsServiceTier(openAIModel, supportedModels), true);
  assert.equal(supportsServiceTier(codexModel, supportedModels), true);
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

test("resolveConfig creates default global config", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    const config = resolveConfig(cwd, home);
    assert.equal(existsSync(paths.global), true);
    assert.equal(config.active, false);
    assert.equal(config.serviceTier, "priority");
    assert.equal(config.supportedModels.some((model) => model.provider === "openai" && model.id === "gpt-5.5"), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
