import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import { fixtures } from './fixtures.mjs';
import { view } from './projector.mjs';
import { createObserver } from './observer.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const modes = ['hidden', 'brief', 'expanded', 'full'];
const requests = [];
let responseText = '';
const originalFetch = globalThis.fetch;
const mockFetch = async (_url, init) => {
  requests.push(init.body);
  const events = [];
  // Split at code points; split the encoded wire again at arbitrary byte offsets.
  const chars = Array.from(responseText);
  for (let i = 0; i < chars.length; i += 7) events.push({ choices: [{ delta: { reasoning_content: chars.slice(i, i + 7).join('') } }] });
  events.push({ choices: [{ delta: { content: 'Recorded response.' }, finish_reason: 'stop' }] });
  events.push({ choices: [], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 }, total_tokens: 150 } });
  const wire = new TextEncoder().encode(events.map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n');
  return new Response(new ReadableStream({ start(c) {
    for (let i = 0; i < wire.length; i += 17) c.enqueue(wire.slice(i, i + 17));
    c.close();
  } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
globalThis.fetch = mockFetch;
const adapter = new DeepSeekAdapter({
  options: () => ({ baseURL: 'https://fixture.invalid', defaults: { thinking: 'enabled', reasoningEffort: 'high' }, streamIdleTimeoutMs: 10000 }),
  resolveApiKey: async () => 'fixture-only-not-a-real-key',
  resolveUserId: () => 'research-fixture',
});

function deepFreeze(x) { if (x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(deepFreeze); } return x; }
function options(text) {
  return deepFreeze({ model: 'research-fixture', system: 'Fixed fixture instructions.', maxTokens: 4096, reasoningEffort: 'high',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Continue the recorded task.' }] },
      { role: 'assistant', content: [{ type: 'reasoning', text }, { type: 'tool-call', id: 'call_fixture', name: 'arbitrary_new_tool', arguments: '{"query":"fixture"}' }] },
      { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_fixture', content: [{ type: 'text', text: 'Recorded tool result.' }] }] },
    ] });
}
const rows = [];
try {
  for (const fixture of fixtures) {
    responseText = fixture.text;
    const requestOptions = options(fixture.text);
    const original = JSON.stringify(requestOptions);
    const modeRows = [];
    for (const mode of modes) {
      const before = requests.length;
      let canonical = '';
      const events = [];
      const started = performance.now();
      // No rendering in the model stream's critical path.
      for await (const event of adapter.stream(requestOptions)) {
        events.push(event);
        if (event.type === 'reasoning-delta') canonical += event.text;
      }
      const protocolReplayMs = performance.now() - started;
      assert.equal(canonical, fixture.text);
      const sourceHash = hash(canonical);
      const renderStarted = performance.now();
      const display = view(canonical, mode);
      const projectionMs = performance.now() - renderStarted;
      for (const quote of display) assert.equal(canonical.slice(quote.start, quote.end), quote.text);
      assert.equal(hash(canonical), sourceHash);
      assert.equal(JSON.stringify(requestOptions), original);
      assert.equal(requests.length - before, 1);
      const wire = requests.at(-1);
      assert.equal(JSON.parse(wire).messages[2].reasoning_content, fixture.text);
      modeRows.push({ mode, requestSha256: hash(wire), eventsSha256: hash(JSON.stringify(events)), sourceSha256: sourceHash,
        displayCharacters: display.reduce((s, x) => s + x.text.length, 0), sourceCharacters: canonical.length,
        projectionMs, protocolReplayMs, mockApiCalls: requests.length - before, excerpts: display });
    }
    assert.equal(new Set(modeRows.map(x => x.requestSha256)).size, 1);
    assert.equal(new Set(modeRows.map(x => x.eventsSha256)).size, 1);
    rows.push({ id: fixture.id, domain: fixture.domain, language: fixture.language, modes: modeRows });
  }
} finally { globalThis.fetch = originalFetch; }

// Warmed local projection benchmark only; not inference time or UI latency.
const sample = fixtures.map(x => x.text).join('\n\n');
const stress = Array(20).fill(sample).join('\n\n');
function benchmark(text) {
  for (let i = 0; i < 10; i++) view(text, 'brief');
  const times = [];
  for (let i = 0; i < 100; i++) { const t = performance.now(); view(text, 'brief'); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  return { characters: text.length, iterations: times.length, p50Ms: times[49], p95Ms: times[94], maxMs: times.at(-1) };
}
// Deliberately withhold an observer's response: main-task progress must continue.
// This validates scheduling/isolation, NOT any real summarizer's quality/cost.
const published = [], pending = [];
const observer = createObserver({
  request: job => new Promise(resolve => pending.push({ job, resolve })),
  publish: value => published.push(value),
});
const tick = () => new Promise(resolve => setImmediate(resolve));
observer.push({ key: 'snapshot-1:plain:v1:zh', text: 'First snapshot' });
await tick();
for (let i = 2; i <= 10; i++) observer.push({ key: `snapshot-${i}:plain:v1:zh`, text: `Snapshot ${i}` });
await tick();
assert.equal(pending.length, 1);
const continuationEvents = [];
globalThis.fetch = mockFetch;
try {
  for await (const event of adapter.stream(options(fixtures.at(-1).text))) continuationEvents.push(event);
} finally { globalThis.fetch = originalFetch; }
assert.equal(hash(JSON.stringify(continuationEvents)), rows.at(-1).modes[0].eventsSha256);
assert.equal(hash(requests.at(-1)), rows.at(-1).modes[0].requestSha256);
const mainTaskFinished = continuationEvents.at(-1).type === 'finish';
assert.equal(mainTaskFinished, true);
assert.equal(published.length, 0);
pending[0].resolve({ text: 'Late result from old snapshot' });
await tick();
assert.equal(pending.length, 2);
assert.equal(pending[1].job.key, 'snapshot-10:plain:v1:zh');
assert.equal(published.length, 0); // stale result suppressed
pending[1].resolve({ text: 'Latest illustrative summary, not a model result' });
await tick();
assert.equal(published.length, 1);
observer.push({ key: 'snapshot-10:plain:v1:zh', text: 'Snapshot 10' });
await tick();
assert.equal(pending.length, 2); // cached display change causes no new request
const observerResults = { scope: 'Deferred Promise simulation; no model called.', mainTaskContinuedBeforeObserverResponse: mainTaskFinished,
  coalescedSnapshots: 10, simulatedSummaryRequests: observer.stats.requests, maxInFlight: observer.stats.maxInFlight,
  cacheHits: observer.stats.cacheHits, staleResultsSuppressed: true };
observer.dispose();
const failingObserver = createObserver({ request: async () => { throw new Error('simulated observer failure'); }, publish: () => assert.fail('error must not be shown as a summary') });
failingObserver.push({ key: 'failure', text: 'fixture' });
await tick();
assert.equal(failingObserver.stats.errors, 1);
failingObserver.dispose();
const result = {
  generatedAt: new Date().toISOString(), scope: 'Synthetic SSE replay through installed DeepSeekAdapter + isolated extraction prototype. Not live model evaluation.',
  fixtureCount: fixtures.length, modes, modeReplayMockCalls: fixtures.length * modes.length,
  observerContinuationMockCalls: 1, mockApiCalls: requests.length, liveApiCalls: 0, billableTokensUsed: 0,
  assertions: { identicalOutboundRequestsAcrossModes: true, identicalProtocolEventsAcrossModes: true, exactReasoningPassback: true, immutableInputs: true, sourceAlignedExcerpts: true },
  benchmarks: { short: benchmark(sample), stress: benchmark(stress) }, observerResults, rows,
};
await writeFile(new URL('./results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
