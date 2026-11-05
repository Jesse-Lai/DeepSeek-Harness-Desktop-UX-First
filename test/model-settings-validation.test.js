import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  configurableProviderViewSchema,
  llmConfirmModelValidationRequestSchema,
  llmValidateModelDraftRequestSchema,
} from "@deepseek-ai/dsh-host-apiproxy/api/llm.schema";

const root = new URL("../", import.meta.url).pathname;
const dependency = (...parts) => join(root, "node_modules", "@deepseek-ai", ...parts);

test("model settings expose required fields and an always-visible connection editor", async () => {
  const source = await readFile(
    dependency("dsh-client-ui-settings-models", "lib", "client.js"),
    "utf8",
  );

  assert.match(source, /STORED_KEY_DOTS = "••••••••••••"/);
  assert.match(source, /customized: "Connection and models"/);
  assert.match(source, /customized: "连接与模型"/);
  assert.doesNotMatch(source, /function IconChevron/);
  assert.doesNotMatch(source, /expanded\.has\(index\)/);
  assert.equal(source.match(/IconTrashOutline16/g)?.length, 2);
  assert.match(source, /children: requiredCopy\(t\("customRoute"\)\)/);
  assert.match(source, /children: requiredCopy\(t\("baseUrl"\)\)/);
  assert.match(source, /children: requiredCopy\(t\("customApi"\)\)/);
  assert.match(source, /children: requiredCopy\(t\("keyInput"\)\)/);
  assert.match(source, /children: requiredCopy\(t\("provider"\)\)/);
  assert.match(source, /row\.apiKeyEnv === void 0 \? \{\} : \{ credentialRequired: true \}/);
  assert.match(source, /target\.credentialRequired === true \? \{ credentialRequired: true \}/);
  assert.equal(
    source.match(/children: props\.required \? requiredCopy\((?:props\.)?t\("modelId"\)\)/g)?.length,
    2,
  );
  assert.equal(source.match(/required: props\.required/g)?.length, 2);
  assert.doesNotMatch(source, /requiredCopy\((?:props\.)?t\("models"\)\)/);
  assert.match(source, /const \[models, setModels\].*\[\{ id: "" \}\]/);
  assert.match(source, /const displayedModels = models\.length === 0 \? \[\{ id: "" \}\] : models/);
  assert.match(source, /showErrors: attempted/);
  assert.match(source, /setAttempted\(true\);\s*if \(!ready\) return/);
  assert.match(source, /setAttempted\(true\);\s*if \(locallyInvalid\) return/);
  assert.match(source, /submitDisabled: disabled \|\| requiredMissing/);
  assert.match(source, /submitDisabled: disabled \|\| layout === "unknown" \|\| requiredMissing/);
  assert.match(source, /requiredModelIdMissing/);
  assert.match(source, /requiresConnection && probeBaseURL === void 0/);
  assert.match(source, /azureDeploymentRequired = props\.provider === "azure-openai-responses"/);
  assert.match(source, /if \(azureDeploymentRequired\) return \[\]/);
  assert.match(source, /requiredModelsMissing = props\.credentialOnly !== true && currentModels\.length === 0/);
  assert.match(source, /api\.sessions\.models\(\{ sessionId: currentSession \}\)/);
  assert.match(source, /current\.reasoningEffort/);
});

test("save validates drafts before mutation and confirms only saved successes", async () => {
  const [source, connection] = await Promise.all([
    readFile(dependency("dsh-client-ui-settings-models", "lib", "client.js"), "utf8"),
    readFile(dependency("dsh-client-connection", "lib", "client.js"), "utf8"),
  ]);

  const validate = source.indexOf("api.llm.validateModelDraft({");
  const createLocalGuard = source.indexOf("if (!ready) return;");
  const providerLocalGuard = source.indexOf("if (locallyInvalid) return;");
  const mutate = source.indexOf("api.settings.mutate({", validate);
  const confirm = source.indexOf("api.llm.confirmModelValidation({", mutate);
  assert.ok(validate >= 0 && mutate > validate && confirm > mutate);
  assert.ok(createLocalGuard >= 0 && createLocalGuard < validate);
  assert.ok(providerLocalGuard > validate && providerLocalGuard < source.indexOf("api.llm.validateModelDraft({", validate + 1));
  assert.match(source, /validModels = models\.filter/);
  assert.match(source, /validationPartial/);
  assert.match(source, /modelEntryInvalid/);
  assert.match(source, /Toast/);
  assert.match(connection, /validateModelDraft: \(payload, signal\) => this\.callUnary\("llm\.validateModelDraft"/);
  assert.match(connection, /confirmModelValidation: \(payload, signal\) => this\.callUnary\("llm\.confirmModelValidation"/);
  assert.match(connection, /"llm\.validateModelDraft": llmValidateModelDraftValueSchema/);
});

test("draft validation RPC rejects incomplete payloads and carries no secret in results", () => {
  assert.throws(() => llmValidateModelDraftRequestSchema.parse({
    settingsNs: "llm-pi-ai",
    provider: "acme",
    profile: {},
    models: [],
  }));

  const request = llmValidateModelDraftRequestSchema.parse({
    settingsNs: "llm-pi-ai",
    provider: "acme",
    profile: { baseURL: "https://example.test/v1", api: "openai-responses" },
    apiKey: "secret-for-one-request",
    models: [{ id: "deployment-a", reasoningEffort: "high" }],
  });
  assert.equal(request.models[0].id, "deployment-a");
  assert.deepEqual(llmConfirmModelValidationRequestSchema.parse({
    provider: "acme",
    models: ["deployment-a"],
  }), { provider: "acme", models: ["deployment-a"] });
  assert.equal(configurableProviderViewSchema.parse({
    provider: "acme",
    displayName: "Acme",
    settingsNs: "llm-pi-ai",
    settingsPath: ["providers", "acme"],
    active: true,
    validation: "valid",
  }).validation, "valid");
});

test("provider validators use bounded sequential real-response probes", async () => {
  const [runtime, deepseek, piAi] = await Promise.all([
    readFile(dependency("dsh-llm", "lib", "index.js"), "utf8"),
    readFile(dependency("dsh-llm-deepseek", "lib", "index.js"), "utf8"),
    readFile(dependency("dsh-llm-pi-ai", "lib", "index.js"), "utf8"),
  ]);

  assert.match(runtime, /registerDraftValidator/);
  assert.match(runtime, /providerValidationStatus/);
  assert.match(runtime, /createHash\("sha256"\)/);
  assert.match(runtime, /reasoningEffort: model\?\.reasoningEffort/);
  assert.match(runtime, /clearValidation\(provider, models\)/);
  assert.match(runtime, /replied && reason\.kind !== "error"/);
  for (const source of [deepseek, piAi]) {
    assert.match(source, /registerDraftValidator/);
    assert.match(source, /for \(const model of request\.models\)/);
    assert.match(source, /AbortSignal\.timeout\(25e3\)/);
    assert.match(source, /Reply with OK\./);
    assert.match(source, /maxTokens: 128/);
    assert.match(source, /credentials\/updated/);
    assert.match(source, /clearValidation/);
  }
  assert.match(piAi, /validationProfileChanges/);
});
