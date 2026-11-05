# 开源 agent 的“摘要”：实现、token 成本与 DeepSeek Harness 设计

核查日期：2026-09-09。本轮新增检查 Cline、Roo Code、OpenCode 的公开源码，并补查 Open WebUI；复用同日已核查的 Codex、Gemini CLI 和模型服务官方文档。所有结论限定于下面固定的提交和调用路径，不代表所有版本、插件与供应商。**这是源码与协议审计，没有执行付费模型调用，也没有真实质量、账单或推理延迟 A/B。**

## 结论

**开源 agent 的 Thinking 区域不一定会额外调用模型。所查主流展示路径主要接收已有 reasoning / provider summary，然后在本地排版、拆标题、折叠。这里的展示操作不产生额外模型 token；原生摘要的生成成本则由供应商决定。**

同时，确实存在另发模型请求的摘要：OpenCode GitHub 工作流的提交说明和行动摘要，以及 Cline / Roo Code / OpenCode 的上下文压缩。它们消耗新的输入和输出 token，不能拿“同一个软件的 Thinking 展示免费”来推断它们免费。

最关键的判断不是软件是否开源、函数是否叫 summary，而是：**文字从哪里来、有没有新生成请求、生成结果是否进入后续模型上下文。**

## 1. Thinking 展示路径：逐项证据

| 项目与固定提交 | 实际路径 | 客户端额外摘要 token | 不能据此推断的事 |
|---|---|---|---|
| Codex `38cbebaf3fe3` | 在同一 Responses 请求设置 `reasoning.summary`；解析 `response.reasoning_summary_text.delta` | 所查路径没有第二次摘要请求；折叠已有内容无新增 token | 不能从客户端源码推出 OpenAI 服务端摘要零计算、零费用、零延迟 |
| Gemini CLI `ed2ac40df67a` | 接收服务商 thought 内容；`parseThought()` 用字符串查找拆出 `**标题**` 和正文；ThinkingMessage 排版 | 标题拆分和排版无新增模型 token | 标题是服务商已经生成的，CLI 没有把任意专业原文免费改写为通俗解释 |
| OpenCode `830d5eb53548` | Responses 请求含 effort / summary；事件累计为 reasoning part；`reasoningSummary()` 拆第一段粗体标题；TUI show / hide 控制展开 | 所查 Thinking 路径无第二次摘要请求；show / hide 为本地状态 | 本地 show / hide 不等于关闭模型推理，也不等于关闭服务商摘要生成 |
| Roo Code `b867ec914575` | OpenAI 路由默认请求 summary auto；Claude 接收 thinking_delta；DeepSeek 接收 reasoning_content；统一交给 ReasoningBlock | 原生内容接收与折叠无第二次摘要请求 | 同一个“Thinking”外观，在不同供应商上可能对应摘要或公开推理文本 |
| Cline `40f1d75bd250` | AI SDK reasoning-delta → SDK reasoning 内容事件 → VS Code message-translator 累计 → ThinkingRow 展示 | 所查展示链路没有独立语义摘要调用 | 不能把其另有的 agentic compaction 当作 Thinking 文本生成器；不同 provider 路由仍需分别确认 |

Roo Code 仓库所取 HEAD 的提交日期是 2026-05-15；其余新增 agent 快照按本轮取得的 HEAD 固定。这里不声称 Roo Code 当天发布了新版本。

### OpenCode：函数叫 summary，但没有生成摘要

[`packages/tui/src/context/thinking.ts:12`](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/tui/src/context/thinking.ts#L12) 的核心操作是：

```ts
const content = text.trim()
const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
if (!match) return { title: null, body: content }
return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() }
```

模型已返回 `**检查缓存失效**` 和后续说明时，界面把标题单独显示，展开再显示正文。没有标题时保留正文，不编造摘要。`useThinkingMode()` 只读写本地 KV；TUI 的 ReasoningPart 根据 hide / show 和展开状态决定渲染。

这不是用户反对的“业务关键词命中＋固定解释模板”：它解析通用格式，不需要列举任务类别。**但语义泛化来自上游模型已经生成的文字；格式解析本身不会解释术语，只看标题也不能保证读到正文中的所有重要纠正。**

其服务商路径另见 [Responses 参数构造](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/llm/src/protocols/openai-responses.ts#L456)、[摘要事件](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/llm/src/protocols/openai-responses.ts#L923)、[运行时累计](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/processor.ts#L278)、[TUI 展示](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/tui/src/routes/session/index.tsx#L1585)。OpenAI 兼容 Chat 路径也直接接收 [`reasoning_content`](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/llm/src/protocols/openai-chat.ts#L419)。

### Roo Code：切换供应商，Thinking 文字的来源会变

- [OpenAI 参数](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/openai-native.ts#L340)：`enableResponsesReasoningSummary` 控制是否附带 `summary: "auto"`，与 effort 分开组装；只在支持的路由和相应条件下设置。
- [Claude 增量](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/anthropic.ts#L262)：直接 yield 服务端的 `thinking_delta`。
- [DeepSeek 增量](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/deepseek.ts#L114)：`delta.reasoning_content` 直接变成 `type: "reasoning"`。
- [ReasoningBlock](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/webview-ui/src/components/chat/ReasoningBlock.tsx#L18)：切换 React 折叠状态，展开时用 MarkdownBlock 渲染 content。

因此，接 DeepSeek 时这条路径没有隐藏的“免费摘要模型”，只是显示 DeepSeek 已经返回的内容。其回传数据另由 [Task.ts](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/task/Task.ts#L851) 保存 reasoning、summary、加密内容或签名；不能把 UI 摘录覆盖到原始数据。

### Cline：直接累计与渲染

[AI SDK 事件读取](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/sdk/packages/llms/src/providers/ai-sdk.ts#L1434) 接收 reasoning 文本；[消息转换](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/src/sdk/message-translator.ts#L1291) 通过 appendStreamingReasoning 累计；[ChatRow](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/webview-ui/src/components/chat/ChatRow.tsx#L884) 把 message.text 交给 ThinkingRow；[ThinkingRow](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/webview-ui/src/components/chat/ThinkingRow.tsx#L88) 做展开、滚动和文本渲染。该链路不执行通俗改写。

## 2. 确实消耗额外 token 的路径

### OpenCode GitHub 工作流：另外请求结果摘要

[`github.handler.ts:886`](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/cli/cmd/github.handler.ts#L886) 的 `summarize(response)` 调用：

```ts
return await chat(`Summarize the following in less than 40 characters:\n\n${response}`)
```

`chat()` 随后在同一 session 中调用 `prompt.prompt()`。这是一次新的生成请求，用于该 GitHub 工作流中的提交说明等；不是 TUI 的 Thinking 展示。即使最终只有 40 个字符，也有请求输入、生成输出以及可能的内部推理成本，不能只数屏幕上的 40 字。

此外，若一次 `chat()` 的响应没有可提取的正文，[950–978 行](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/cli/cmd/github.handler.ts#L950) 会再请求 “Summarize the actions (tool calls & reasoning) ... in 1-2 sentences.”，并等待返回。这是有条件的行动摘要调用，不是每个 reasoning delta 都触发。

这条实现复用同一 session，不能直接视为对主上下文完全隔离的观察器。它能说明：**另一次摘要请求不要求另一个模型；调用同一个模型也会新增 token。**

### 上下文压缩：生成时花 token，后续可能省 token

| 项目 | 生成证据 | 后续用途与影响 |
|---|---|---|
| Roo Code | `src/core/condense/index.ts:328` 调用 `apiHandler.createMessage(...)`，随后读取 usage、totalCost、outputTokens | 摘要变为 user 消息，替代被折叠历史；会改变后续模型输入 |
| Cline | `agentic-compaction.ts:79` 调用 `handler.createMessage(...)`；可配置 summarizer，未指定则按当前 provider 配置解析 | 等摘要完成后构造 summary + recent messages；模型生成型压缩不能与不调模型的 basic 策略混淆 |
| OpenCode | `session/compaction.ts:358` 选 compaction agent / model，425 行调用 processor.process 并等待 | 将对话写成续接摘要并保留选定尾部；这属于上下文管理 |

源码：[Roo Code 调用及计费字段](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/condense/index.ts#L323)、[替代后的历史](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/condense/index.ts#L451)、[Cline 调用](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/sdk/packages/core/src/extensions/context/agentic-compaction.ts#L70)、[Cline 续接](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/sdk/packages/core/src/extensions/context/agentic-compaction.ts#L253)、[OpenCode compaction](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/compaction.ts#L358)。

这种摘要有新增生成消耗，但压短历史后，未来多个请求可能节省更多输入 token。**“这次摘要额外消耗”与“全任务最终净消耗更低”可以同时成立。** 是否净节省取决于摘要调用量、压缩比例、后续轮数、缓存和重试；是否损害质量取决于重要信息是否保留，不能承诺不影响。

### 主模型直接写进度说明：没有第二次调用也可能花 token

OpenCode [gpt prompt](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/prompt/gpt.txt#L83) 要求工作时用 commentary 发送简短进度。这类文字是主模型的输出；属于正常输出 token，不是客户端免费摘要。若为可读性额外加入此类指令，会改变主模型输入，输出长度与总耗时也可能变化；未做对照时无法量化净增 token。

## 3. 服务商费用：开源客户端不能替供应商作保证

- **Claude**：官方明确摘要由另一个模型生成，主推理模型看不到摘要；Summary generation 为 No charge。显示 summarized / omitted 的计费依据相同，按主模型完整思考计费。另有 minimal added latency。含义是客户不额外支付摘要生成费，服务端仍有生成工作。只适用于相应 Claude 原生能力，不适用于自行再发一次 Claude 请求要求总结。
- **OpenAI / Codex 路由**：源码证明同一 Responses 请求获得摘要，没有客户端第二次调用；当前证据不足以确认摘要生成独立零收费、服务端严格隔离或零额外延迟。不能把 Claude 的条款搬过来。
- **Gemini**：官方按完整 thinking 计量，而不是按可见短摘要估价；CLI 的解析和排版不新增生成。尚没有本次可引用的、与 Claude 同样明确的 summary generation 免费条款。当前文档示例为 Interactions，不能将其 usage 字段直接套到 CLI 所用的其他协议。
- **DeepSeek 路由**：已检查 Roo Code、OpenCode 兼容协议和本项目官方 adapter 的 reasoning_content 接收路径。这些客户端不为显示它另做摘要；DeepSeek 全部端点是否提供独立原生摘要和当前精确计费，不能仅靠客户端代码作全局断言。沿用上一轮官方文档站连接失败的限制。

官方依据：[Claude 摘要机制](https://platform.claude.com/docs/en/build-with-claude/thinking#summarized-thinking)、[Claude 计费](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost#pricing)、[OpenAI reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries)、[Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)。同日缓存与 SHA-256 见 sources.json。

## 4. 对 DeepSeek Harness 四个目标的回答

| 路线 | 不额外 token | 不干预主推理 | 不依赖业务模板 | 不增加主推理等待 | 能否把专业内容改成通俗解释 |
|---|---|---|---|---|---|
| 接收已返回的摘要/推理，保留结构并本地展开 | 展示操作满足 | 保持请求与完整回传不变时满足 | 满足，格式解析可跨任务 | 无新增模型等待；仍有本地渲染成本 | 取决于上游已返回的文字，客户端不会凭空改写 |
| 请求服务商原生摘要 | 客户新增费用看供应商；服务端计算不是零 | Claude 有明确隔离依据；其他供应商分别核查 | 由服务商模型泛化 | 服务端可能有少量摘要延迟 | 详略可调不等于一定支持通俗/专业风格 |
| Harness 单独请求解释模型，异步只读旁路 | 新生成会额外消耗，缓存复用除外 | 不回写 history、不更改主请求时可隔离 | 模型可泛化，须评估忠实性 | 可以不等待解释，但解释本身晚到；仍需测资源竞争 | 可以专门实现该需求 |
| 主模型按提示输出进度/通俗推理 | 不保证净 token 不增 | 改了主输入，不能宣称无影响 | 可以泛化 | 可能影响输出与耗时 | 可以尝试，但不符合严格隔离目标 |
| 上下文 compaction | 生成时增加，后续可能净节省 | 改变后续上下文 | 模型可泛化 | 通常需完成压缩后续接 | 目标是续接任务，不应拿来当只读可读性功能 |

**建议：先复制开源 agent 已验证的“接收＋展示”结构，把 provider-summary 与 reasoning-text 区分，保留原始协议数据；模型已经返回标题/摘要时，就地利用。** 这样展示功能本身可以做到零新增模型 token、无主推理输入改动、跨任务、无新增模型等待。

如果产品承诺的是截图中“同一份专业推理可以滑成普通用户真正看懂的解释”，还必须确认上游已经提供这种语义表达。**本轮没有找到这些开源 Thinking 展示链路在任意 DeepSeek 文本上，完成这种通俗改写且同时满足四项严格条件的证据。** 这不是证明任何未来技术都不可能，而是不能把折叠/拆标题或服务商赠送摘要宣传为已解决通用语义改写。

## 5. 补充检查与证据边界

Open WebUI 不是本轮的主要编码 agent 样本，仅作展示层交叉检查。固定提交 `0a7c15832fb30b1903753e83f81dc7d27e5b0944` 中，[structuredOutput.ts](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/src/lib/components/chat/Messages/structuredOutput.ts#L609) 累计 provider reasoning_summary_text；247 行的 `summary` 是 “Thinking... / Thought for ... seconds” 折叠标题，不能因字段名就说它做了语义摘要。未据此断言所有插件都不调用摘要模型。

Codex 原始源码：[请求](https://github.com/openai/codex/blob/38cbebaf3fe3e81a94bf462079e7cf9659fc9e50/codex-rs/core/src/client.rs#L870)、[事件](https://github.com/openai/codex/blob/38cbebaf3fe3e81a94bf462079e7cf9659fc9e50/codex-rs/codex-api/src/sse/responses.rs#L381)。Gemini CLI：[标题解析](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/utils/thoughtUtils.ts#L26)、[展示](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/messages/ThinkingMessage.tsx#L56)。

新增源码哈希、核查行号和摘录保存在 open-source-sources.json 与 open-source-evidence.md。本轮没有修改应用生产代码或设置，没有声称完成真实计费或质量测试。
