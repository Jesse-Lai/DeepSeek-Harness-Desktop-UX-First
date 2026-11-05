import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CompanionRuntime } from './runtime.js';
import { startCompanionServer } from './server.js';
import { installImageTool } from './image-tool.js';
export const inject = ['apiProxy', 'llm', 'agentDefaultModel', 'attachments'];
export async function apply(ctx) {
  const token = process.env.DSH_COMPANION_TOKEN;
  const dataRoot = process.env.DSH_COMPANION_DATA;
  if (!token || !dataRoot) return;
  const visualModel = process.env.DSH_COMPANION_VISUAL_PROVIDER && process.env.DSH_COMPANION_VISUAL_MODEL
    ? { provider: process.env.DSH_COMPANION_VISUAL_PROVIDER, model: process.env.DSH_COMPANION_VISUAL_MODEL } : undefined;
  // The desktop plugin is copied into DSH_HOME; resolve host APIs from the running CLI.
  const { defineTool } = await import(pathToFileURL(createRequire(process.argv[1]).resolve('@deepseek-ai/dsh-tools')).href);
  ctx.on('agent/created', ({ agent }) => installImageTool(agent, ctx.attachments, defineTool));
  ctx.effect(() => {
    let disposed = false;
    let server;
    const ready = new CompanionRuntime({
      api: ctx.apiProxy, llm: ctx.llm, attachments: ctx.attachments,
      defaultModel: () => ctx.agentDefaultModel.currentSelection(), dataRoot, visualModel,
    }).init().then(async (runtime) => {
      server = await startCompanionServer(runtime, token);
      if (disposed) { await server.close(); server = undefined; }
      else console.log(`dsh companion: ${server.url}`);
    }).catch((e) => console.error('DSH companion failed:', e.message));
    return async () => { disposed = true; await ready; if (server) await server.close(); };
  });
}
