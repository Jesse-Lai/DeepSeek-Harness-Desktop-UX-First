
/** Uses a configured image-generation deployment. Credentials stay in the Harness process. */
export async function generateImage(prompt, signal, env = process.env, fetcher = fetch) {
  const endpoint = env.DSH_COMPANION_IMAGE_URL;
  if (!endpoint) throw new Error('请配置 DSH_COMPANION_IMAGE_URL、DSH_COMPANION_IMAGE_MODEL 和 DSH_COMPANION_IMAGE_API_KEY 后使用配图。 / Configure the DSH image provider first.');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Image provider must use HTTPS');
  const response = await fetcher(url, {
    method: 'POST', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180000)]),
    headers: { 'Content-Type': 'application/json', ...(env.DSH_COMPANION_IMAGE_API_KEY ? { Authorization: `Bearer ${env.DSH_COMPANION_IMAGE_API_KEY}`, 'api-key': env.DSH_COMPANION_IMAGE_API_KEY } : {}) },
    body: JSON.stringify({ model: env.DSH_COMPANION_IMAGE_MODEL ?? 'gpt-image-1', prompt, n: 1, size: '1536x1024' }),
  });
  if (!response.ok) throw new Error(`Image provider: HTTP ${response.status}`);
  const body = await response.json();
  const base64 = body.data?.[0]?.b64_json;
  if (!base64 || base64.length > 22 * 1024 * 1024) throw new Error('Image provider must return a base64 image');
  return { data: Buffer.from(base64, 'base64'), mediaType: 'image/png', name: 'Generated image.png' };
}
export function installImageTool(agent, attachments, defineTool) {
  if (!agent.ctx.tools || !attachments) return;
  agent.ctx.tools.register(defineTool({
    name: 'generate_image', description: 'Generate an image for the user and return a durable image attachment. Use for illustration and document-image requests.',
    parameters: { prompt: { type: 'string', required: true, description: 'Detailed image prompt.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { attachment: { type: 'object', required: true, additionalProperties: true } } },
      render: (_args, value) => [{ type: 'image', attachment: value.attachment }],
    },
    timeoutMs: 190000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args.prompt.trim() || args.prompt.length > 32000) throw new Error('Invalid image prompt');
      const image = await generateImage(args.prompt, exec.signal);
      return { attachment: await attachments.saveImage(image) };
    },
  }));
}
