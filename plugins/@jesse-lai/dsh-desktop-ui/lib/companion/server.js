import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export async function startCompanionServer(runtime, token) {
  if (!token || token.length < 32) throw new Error('Companion requires a per-launch secret');
  const expected = Buffer.from(`Bearer ${token}`);
  const controllers = new Set();
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403).end(); return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && url.pathname === '/api/agent-status') return json(await runtime.status());
      if (req.method === 'GET' && url.pathname === '/api/runs/events') {
        const runId = url.searchParams.get('runId');
        const run = runtime.runs.get(runId);
        if (!run) { res.writeHead(404).end('Unknown run'); return; }
        const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const send = (e) => {
          if (e.run.id !== runId || e.cursor <= after || res.destroyed) return;
          res.write(`data: ${JSON.stringify(e)}\n\n`);
          if (e.output?.type === 'done') res.end();
        };
        for (const e of run.events) send(e);
        if (!['queued', 'running', 'waiting_approval'].includes(run.status)) {
          if (!res.writableEnded) res.end(); return;
        }
        runtime.listeners.add(send);
        const timer = setInterval(() => res.write(': keepalive\n\n'), 15000);
        res.on('close', () => { clearInterval(timer); runtime.listeners.delete(send); });
        return;
      }
      if (req.method !== 'POST') { res.writeHead(404).end(); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (url.pathname === '/api/do-anything') return json(await runtime.start(body));
      if (url.pathname === '/api/approval') { await runtime.approve(body); return json({ ok: true }); }
      if (url.pathname === '/api/cancel') { await runtime.cancel(body); return json({ ok: true }); }
      if (url.pathname === '/api/quick-tasks') {
        const abort = new AbortController(); controllers.add(abort);
        res.on('close', () => { abort.abort(); controllers.delete(abort); });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        try {
          for await (const event of runtime.quick(body, abort.signal)) {
            if (!res.destroyed) res.write(JSON.stringify(event) + '\n');
          }
        } catch (e) { if (!res.destroyed) res.write(JSON.stringify({ type: 'error', error: e.message }) + '\n'); }
        res.end(); return;
      }
      res.writeHead(404).end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const abort of controllers) abort.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await runtime.close();
    },
  };
}
