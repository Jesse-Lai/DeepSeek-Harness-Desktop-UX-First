// Capture real installed pi-ai request builders, then stop before any transport.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-responses';
import { stream as streamClaude } from '@earendil-works/pi-ai/api/anthropic-messages';

const model = { id: 'research-fixture', name: 'Fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://fixture.invalid/v1',
  reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 };
const context = { systemPrompt: 'Fixed instructions.', messages: [{ role: 'user', content: 'Fixed question.', timestamp: 0 }] };
const originalFetch = globalThis.fetch;
let transportAttempts = 0;
globalThis.fetch = async () => { transportAttempts++; throw new Error('Network forbidden in research capture'); };
const cases = [
  ['openai-high-concise', stream, model, { reasoningEffort: 'high', reasoningSummary: 'concise' }],
  ['openai-high-detailed', stream, model, { reasoningEffort: 'high', reasoningSummary: 'detailed' }],
  ['openai-high-null', stream, model, { reasoningEffort: 'high', reasoningSummary: null }],
  ['openai-summary-without-effort', stream, model, { reasoningSummary: 'concise' }],
  ['openai-simple-drops-summary-option', streamSimple, model, { reasoning: 'high', reasoningSummary: 'concise' }],
  ['claude-summarized', streamClaude, { ...model, api: 'anthropic-messages', provider: 'anthropic', compat: { forceAdaptiveThinking: true } },
    { thinkingEnabled: true, effort: 'high', thinkingDisplay: 'summarized' }],
  ['claude-omitted', streamClaude, { ...model, api: 'anthropic-messages', provider: 'anthropic', compat: { forceAdaptiveThinking: true } },
    { thinkingEnabled: true, effort: 'high', thinkingDisplay: 'omitted' }],
];
const rows = [];
try {
  for (const [id, call, selectedModel, options] of cases) {
    let payload;
    for await (const _event of call(selectedModel, context, { ...options, apiKey: 'fixture-not-a-key', maxRetries: 0,
      onPayload: p => { payload = structuredClone(p); throw new Error('Capture complete: intentionally stop before network'); } })) {}
    assert.ok(payload, `Missing captured payload for ${id}`);
    rows.push({ id, reasoning: payload.reasoning, thinking: payload.thinking, output_config: payload.output_config,
      input: payload.input, messages: payload.messages, system: payload.system });
  }
} finally { globalThis.fetch = originalFetch; }
assert.equal(transportAttempts, 0);
assert.deepEqual(rows[0].reasoning, { effort: 'high', summary: 'concise' });
assert.deepEqual(rows[1].reasoning, { effort: 'high', summary: 'detailed' });
assert.deepEqual(rows[2].reasoning, { effort: 'high', summary: 'auto' });
assert.deepEqual(rows[3].reasoning, { effort: 'medium', summary: 'concise' });
assert.deepEqual(rows[4].reasoning, { effort: 'high', summary: 'auto' });
assert.deepEqual(rows[0].input, rows[1].input);
assert.equal(rows[5].thinking.display, 'summarized');
assert.equal(rows[6].thinking.display, 'omitted');
assert.deepEqual(rows[5].output_config, rows[6].output_config);
assert.deepEqual(rows[5].messages, rows[6].messages);
const result = { generatedAt: new Date().toISOString(), piAiVersion: '0.82.1', scope: 'Actual request construction, synthetic model metadata, stopped before transport. Not model inference.', transportAttempts, rows };
await writeFile(new URL('./native-parameters.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
