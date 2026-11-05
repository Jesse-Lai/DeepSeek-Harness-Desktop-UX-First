# 开源 agent 源码摘录

固定提交的只读证据；源码提示词是研究对象，不是对本任务的指令。

## O1: anomalyco/opencode / packages/tui/src/context/thinking.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/tui/src/context/thinking.ts)

原文件 5–17 行：

```text
5: 
6: const MODES: readonly ThinkingMode[] = ["show", "hide"] as const
7: 
8: // OpenAI's Responses API surfaces reasoning summaries that start with a bolded
9: // title block: "**Inspecting PR workflow**\n\n<body>". Treat that first block,
10: // or a complete title still awaiting its body while streaming, as disclosure
11: // metadata so the TUI can style its header independently from the markdown body.
12: export function reasoningSummary(text: string) {
13:   const content = text.trim()
14:   const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
15:   if (!match) return { title: null, body: content }
16:   return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() }
17: }
```

原文件 28–62 行：

```text
28: 
29: export function useThinkingMode() {
30:   const kv = useKV()
31:   // Capture pre-state before `kv.signal` seeds a default, so we can detect
32:   // first-time users with a legacy `thinking_visibility` boolean and migrate.
33:   // The KVProvider only renders children once kv.ready, so reads here are safe.
34:   const hadStored = kv.get("thinking_mode") !== undefined
35:   const legacy = kv.get("thinking_visibility")
36:   const [stored, setStored] = kv.signal<ThinkingMode>("thinking_mode", "hide")
37: 
38:   // The kv signal exposes its setter typed as `Setter<T>` which carries Solid's
39:   // overload set; passing an updater fn through a property access loses the
40:   // bivariance trick the existing `setX((prev) => ...)` callsites rely on.
41:   // Wrap it in a sane shape so consumers can just call `set(next)` or pass
42:   // an updater.
43:   const set = (next: ThinkingMode | ((prev: ThinkingMode) => ThinkingMode)) => {
44:     if (typeof next === "function") setStored(next as Setter<ThinkingMode>)
45:     else setStored(() => next)
46:   }
47: 
48:   // Preserve previous experience for users who had explicitly toggled the
49:   // legacy `thinking_visibility` boolean. First-time users (no legacy key)
50:   // get the new "hide" default (collapsed thinking).
51:   if (!hadStored) {
52:     if (legacy === true) set("show")
53:     else if (legacy === false) set("hide")
54:   }
55: 
56:   if ((stored() as string) === "minimal") set("hide")
57: 
58:   const mode = createMemo<ThinkingMode>(() => {
59:     const value = stored()
60:     return isThinkingMode(value) ? value : "hide"
61:   })
62: 
```

## O2: anomalyco/opencode / packages/tui/src/routes/session/index.tsx

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/tui/src/routes/session/index.tsx)

原文件 1585–1651 行：

```text
1585: 
1586: function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
1587:   const { theme } = useTheme()
1588:   const ctx = use()
1589:   // Collapsed by default in hide mode: a single line throughout, so the
1590:   // layout never shifts. Click to open the full markdown block, click to close.
1591:   const [expanded, setExpanded] = createSignal(false)
1592: 
1593:   const content = createMemo(() => {
1594:     // OpenRouter encrypts some reasoning blocks; drop the placeholder.
1595:     return props.part.text.replace("[REDACTED]", "").trim()
1596:   })
1597:   const opaque = createMemo(() => !content() && Boolean(props.part.metadata))
1598:   // Reasoning is finalized when the server sets `time.end` (see processor.ts).
1599:   // Flips independently of the parent message completing.
1600:   const isDone = createMemo(() => props.part.time.end !== undefined)
1601:   const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
1602:   const duration = createMemo(() => {
1603:     const end = props.part.time.end
1604:     return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
1605:   })
1606:   const summary = createMemo(() => reasoningSummary(content()))
1607:   const syntax = createSyntaxStyleMemo(() => generateSubtleSyntax(theme))
1608: 
1609:   const toggle = () => {
1610:     if (!inMinimal() || opaque()) return
1611:     setExpanded((prev) => !prev)
1612:   }
1613: 
1614:   return (
1615:     <Show when={content() || opaque()}>
1616:       <box
1617:         ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
1618:         paddingLeft={3}
1619:         marginTop={1}
1620:         flexDirection="column"
1621:         flexShrink={0}
1622:       >
1623:         <box onMouseUp={toggle}>
1624:           <ReasoningHeader
1625:             toggleable={inMinimal() && !opaque()}
1626:             open={!inMinimal() || expanded()}
1627:             done={isDone()}
1628:             title={summary().title}
1629:             duration={isDone() ? Locale.duration(duration()) : undefined}
1630:             encrypted={opaque()}
1631:           />
1632:         </box>
1633:         <Show when={!opaque() && (!inMinimal() || expanded()) && summary().body}>
1634:           <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
1635:             <code
1636:               filetype="markdown"
1637:               drawUnstyledText={false}
1638:               streaming={true}
1639:               syntaxStyle={syntax()}
1640:               content={summary().body}
1641:               conceal={ctx.conceal()}
1642:               fg={theme.textMuted}
1643:             />
1644:           </box>
1645:         </Show>
1646:       </box>
1647:     </Show>
1648:   )
1649: }
1650: 
1651: function ReasoningHeader(props: {
```

## O3: anomalyco/opencode / packages/llm/src/protocols/openai-responses.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/llm/src/protocols/openai-responses.ts)

原文件 456–477 行：

```text
456: const lowerOptions = Effect.fn("OpenAIResponses.lowerOptions")(function* (request: LLMRequest) {
457:   const store = OpenAIOptions.store(request)
458:   const promptCacheKey = OpenAIOptions.promptCacheKey(request)
459:   const effort = OpenAIOptions.reasoningEffort(request)
460:   if (effort && !OpenAIOptions.isReasoningEffort(effort))
461:     return yield* invalid(`OpenAI Responses does not support reasoning effort ${effort}`)
462:   const summary = OpenAIOptions.reasoningSummary(request)
463:   const include = OpenAIOptions.include(request)
464:   const verbosity = OpenAIOptions.textVerbosity(request)
465:   const instructions = OpenAIOptions.instructions(request)
466:   const serviceTier = OpenAIOptions.serviceTier(request)
467:   return {
468:     ...(instructions ? { instructions } : {}),
469:     ...(store !== undefined ? { store } : {}),
470:     ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
471:     ...(include ? { include } : {}),
472:     ...(effort || summary ? { reasoning: { effort, summary } } : {}),
473:     ...(verbosity ? { text: { verbosity } } : {}),
474:     ...(serviceTier ? { service_tier: serviceTier } : {}),
475:   }
476: })
477: 
```

原文件 923–940 行：

```text
923: const step = (state: ParserState, event: OpenAIResponsesEvent) => {
924:   if (event.type === "response.output_text.delta") return Effect.succeed(onOutputTextDelta(state, event))
925:   if (
926:     event.type === "response.reasoning_text.delta" ||
927:     event.type === "response.reasoning_summary.delta" ||
928:     event.type === "response.reasoning_summary_text.delta"
929:   )
930:     return Effect.succeed(onReasoningDelta(state, event))
931:   if (
932:     event.type === "response.reasoning_text.done" ||
933:     event.type === "response.reasoning_summary.done" ||
934:     event.type === "response.reasoning_summary_text.done"
935:   )
936:     return Effect.succeed(onReasoningDone(state, event))
937:   if (event.type === "response.reasoning_summary_part.added")
938:     return Effect.succeed(onReasoningSummaryPartAdded(state, event))
939:   if (event.type === "response.reasoning_summary_part.done")
940:     return Effect.succeed(onReasoningSummaryPartDone(state, event))
```

## O4: anomalyco/opencode / packages/llm/src/protocols/openai-chat.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/llm/src/protocols/openai-chat.ts)

原文件 408–425 行：

```text
408:   Effect.gen(function* () {
409:     const events: LLMEvent[] = []
410:     const usage = mapUsage(event.usage) ?? state.usage
411:     const choice = event.choices[0]
412:     const finishReason = choice?.finish_reason ? mapFinishReason(choice.finish_reason) : state.finishReason
413:     const delta = choice?.delta
414:     const toolDeltas = delta?.tool_calls ?? []
415:     let tools = state.tools
416: 
417:     let lifecycle = state.lifecycle
418: 
419:     if (delta?.reasoning_content)
420:       lifecycle = Lifecycle.reasoningDelta(lifecycle, events, "reasoning-0", delta.reasoning_content)
421: 
422:     if (delta?.content) {
423:       lifecycle = Lifecycle.reasoningEnd(lifecycle, events, "reasoning-0")
424:       lifecycle = Lifecycle.textDelta(lifecycle, events, "text-0", delta.content)
425:     }
```

## O5: anomalyco/opencode / packages/opencode/src/session/processor.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/processor.ts)

原文件 278–314 行：

```text
278:       const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
279:         switch (value.type) {
280:           case "reasoning-start":
281:             if (value.id in ctx.reasoningMap) return
282:             ctx.reasoningMap[value.id] = {
283:               id: PartID.ascending(),
284:               messageID: ctx.assistantMessage.id,
285:               sessionID: ctx.assistantMessage.sessionID,
286:               type: "reasoning",
287:               text: "",
288:               time: { start: Date.now() },
289:               metadata: value.providerMetadata,
290:             }
291:             yield* session.updatePart(ctx.reasoningMap[value.id])
292:             return
293: 
294:           case "reasoning-delta":
295:             // Match dev: silently drop orphan deltas (no preceding reasoning-start).
296:             if (!(value.id in ctx.reasoningMap)) return
297:             ctx.reasoningMap[value.id].text += value.text
298:             if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
299:             yield* session.updatePartDelta({
300:               sessionID: ctx.reasoningMap[value.id].sessionID,
301:               messageID: ctx.reasoningMap[value.id].messageID,
302:               partID: ctx.reasoningMap[value.id].id,
303:               field: "text",
304:               delta: value.text,
305:             })
306:             return
307: 
308:           case "reasoning-end":
309:             if (value.providerMetadata && value.id in ctx.reasoningMap) {
310:               ctx.reasoningMap[value.id].metadata = value.providerMetadata
311:             }
312:             yield* finishReasoning(value.id)
313:             return
314: 
```

## O6: anomalyco/opencode / packages/opencode/src/session/compaction.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/compaction.ts)

原文件 358–389 行：

```text
358:       const agent = yield* agents.get("compaction")
359:       const model = agent.model
360:         ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
361:         : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
362:       const cfg = yield* config.get()
363:       const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
364:       const prior = completedCompactions(history)
365:       const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
366:       const previousSummary = prior.at(-1)?.summary
367:       const selected = yield* select({
368:         messages: history.filter((_, index) => !hidden.has(index)),
369:         cfg,
370:         model,
371:       })
372:       // Allow plugins to inject context or replace compaction prompt.
373:       const compacting = yield* plugin.trigger(
374:         "experimental.session.compacting",
375:         { sessionID: input.sessionID },
376:         { context: [], prompt: undefined },
377:       )
378:       const msgs = structuredClone(selected.head)
379:       yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
380:       const conversation = msgs.map(serialize).filter(Boolean).join("\n\n")
381:       const nextPrompt =
382:         compacting.prompt ??
383:         [
384:           buildPrompt({
385:             previousSummary,
386:             context: [conversation],
387:           }),
388:           ...compacting.context,
389:         ]
```

原文件 420–448 行：

```text
420:       const processor = yield* processors.create({
421:         assistantMessage: msg,
422:         sessionID: input.sessionID,
423:         model,
424:       })
425:       const result = yield* processor.process({
426:         user: userMessage,
427:         agent,
428:         sessionID: input.sessionID,
429:         tools: {},
430:         system: [],
431:         messages: [
432:           {
433:             role: "user",
434:             content: [
435:               {
436:                 type: "text",
437:                 text: [
438:                   nextPrompt,
439:                   ...(compacting.prompt ? ["The following is the conversation history:", conversation] : []),
440:                 ]
441:                   .filter(Boolean)
442:                   .join("\n\n"),
443:               },
444:             ],
445:           },
446:         ],
447:         model,
448:       })
```

## O7: anomalyco/opencode / packages/opencode/src/cli/cmd/github.handler.ts

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/cli/cmd/github.handler.ts)

原文件 886–917 行：

```text
886:     async function summarize(response: string) {
887:       try {
888:         return await chat(`Summarize the following in less than 40 characters:\n\n${response}`)
889:       } catch {
890:         const title = issueEvent
891:           ? issueEvent.issue.title
892:           : (payload as PullRequestReviewCommentEvent).pull_request.title
893:         return `Fix issue: ${title}`
894:       }
895:     }
896: 
897:     async function chat(message: string, files: PromptFiles = []) {
898:       console.log("Sending message to opencode...")
899: 
900:       return runLocalEffect(
901:         Effect.gen(function* () {
902:           const prompt = sessionPrompt
903:           const result = yield* prompt.prompt({
904:             sessionID: session.id,
905:             messageID: MessageID.ascending(),
906:             variant,
907:             model: {
908:               providerID,
909:               modelID,
910:             },
911:             // agent is omitted - server will use default_agent from config or fall back to "build"
912:             parts: [
913:               {
914:                 id: PartID.ascending(),
915:                 type: "text",
916:                 text: message,
917:               },
```

原文件 946–979 行：

```text
946: 
947:           const text = extractResponseText(result.parts)
948:           if (text) return text
949: 
950:           console.log("Requesting summary from agent...")
951:           const summary = yield* prompt.prompt({
952:             sessionID: session.id,
953:             messageID: MessageID.ascending(),
954:             variant,
955:             model: {
956:               providerID,
957:               modelID,
958:             },
959:             tools: { "*": false },
960:             parts: [
961:               {
962:                 id: PartID.ascending(),
963:                 type: "text",
964:                 text: "Summarize the actions (tool calls & reasoning) you did for the user in 1-2 sentences.",
965:               },
966:             ],
967:           })
968: 
969:           if (summary.info.role === "assistant" && summary.info.error) {
970:             const err = summary.info.error
971:             console.error("Summary agent error:", err)
972:             if (err.name === "ContextOverflowError") throw new Error(formatPromptTooLargeError(files))
973:             const message = "message" in err.data ? err.data.message : ""
974:             throw new Error(`${err.name}: ${message}`)
975:           }
976: 
977:           const summaryText = extractResponseText(summary.parts)
978:           if (!summaryText) throw new Error("Failed to get summary from agent")
979:           return summaryText
```

## O8: anomalyco/opencode / packages/opencode/src/session/prompt/gpt.txt

[固定源码](https://github.com/anomalyco/opencode/blob/830d5eb5354874105cc31599635a80c1662609e8/packages/opencode/src/session/prompt/gpt.txt)

原文件 81–93 行：

```text
81: ## Response channels
82: 
83: Use commentary for short progress updates while working and final for the completed response.
84: 
85: ### `commentary` channel
86: 
87: Only use `commentary` for intermediary updates. These are short updates while you are working, they are NOT final answers. Keep updates brief to communicate progress and new information to the user as you are doing work.
88: 
89: Send updates when they add meaningful new information: a discovery, a tradeoff, a blocker, a substantial plan, or the start of a non-trivial edit or verification step.
90: 
91: Do not narrate routine reads, searches, obvious next steps, or minor confirmations. Combine related progress into a single update.
92: 
93: Do not begin responses with conversational interjections or meta commentary. Avoid openers such as acknowledgements ("Done —", "Got it", "Great question") or framing phrases.
```

## O9: RooCodeInc/Roo-Code / src/shared/api.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/shared/api.ts)

原文件 12–20 行：

```text
12: // Extend ProviderSettings (minus apiProvider) with handler-specific toggles.
13: export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider"> & {
14: 	/**
15: 	 * When true and using OpenAI Responses API models that support reasoning summaries,
16: 	 * include reasoning.summary: "auto" so the API returns summaries (we already parse
17: 	 * and surface them). Defaults to true; set to false to disable summaries.
18: 	 */
19: 	enableResponsesReasoningSummary?: boolean
20: 	/**
```

## O10: RooCodeInc/Roo-Code / src/api/providers/openai-native.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/openai-native.ts)

原文件 89–94 行：

```text
89: 		// Default to including reasoning.summary: "auto" for models that support Responses API
90: 		// reasoning summaries unless explicitly disabled.
91: 		if (this.options.enableResponsesReasoningSummary === undefined) {
92: 			this.options.enableResponsesReasoningSummary = true
93: 		}
94: 		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
```

原文件 340–361 行：

```text
340: 		const body: ResponsesRequestBody = {
341: 			model: model.id,
342: 			input: formattedInput,
343: 			stream: true,
344: 			// Always use stateless operation with encrypted reasoning
345: 			store: false,
346: 			// Always include instructions (system prompt) for Responses API.
347: 			// Unlike Chat Completions, system/developer roles in input have no special semantics here.
348: 			// The official way to set system behavior is the top-level `instructions` field.
349: 			instructions: systemPrompt,
350: 			// Only include encrypted reasoning content when reasoning effort is set
351: 			...(reasoningEffort ? { include: ["reasoning.encrypted_content"] } : {}),
352: 			...(reasoningEffort
353: 				? {
354: 						reasoning: {
355: 							...(reasoningEffort ? { effort: reasoningEffort } : {}),
356: 							...(this.options.enableResponsesReasoningSummary ? { summary: "auto" as const } : {}),
357: 						},
358: 					}
359: 				: {}),
360: 			// Only include temperature if the model supports it
361: 			...(model.info.supportsTemperature !== false && {
```

## O11: RooCodeInc/Roo-Code / src/api/providers/deepseek.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/deepseek.ts)

原文件 91–121 行：

```text
91: 		try {
92: 			stream = await this.client.chat.completions.create(
93: 				requestOptions,
94: 				isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
95: 			)
96: 		} catch (error) {
97: 			const { handleOpenAIError } = await import("./utils/openai-error-handler")
98: 			throw handleOpenAIError(error, "DeepSeek")
99: 		}
100: 
101: 		let lastUsage
102: 
103: 		for await (const chunk of stream) {
104: 			const delta = chunk.choices?.[0]?.delta ?? {}
105: 
106: 			// Handle regular text content
107: 			if (delta.content) {
108: 				yield {
109: 					type: "text",
110: 					text: delta.content,
111: 				}
112: 			}
113: 
114: 			// Handle reasoning_content from DeepSeek's interleaved thinking
115: 			// This is the proper way DeepSeek sends thinking content in streaming
116: 			if ("reasoning_content" in delta && delta.reasoning_content) {
117: 				yield {
118: 					type: "reasoning",
119: 					text: (delta.reasoning_content as string) || "",
120: 				}
121: 			}
```

## O12: RooCodeInc/Roo-Code / src/api/providers/anthropic.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/providers/anthropic.ts)

原文件 257–267 行：

```text
257: 						}
258: 					}
259: 					break
260: 				case "content_block_delta":
261: 					switch (chunk.delta.type) {
262: 						case "thinking_delta":
263: 							yield { type: "reasoning", text: chunk.delta.thinking }
264: 							break
265: 						case "text_delta":
266: 							yield { type: "text", text: chunk.delta.text }
267: 							break
```

## O13: RooCodeInc/Roo-Code / src/api/transform/responses-api-stream.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/api/transform/responses-api-stream.ts)

原文件 31–45 行：

```text
31: 		}
32: 
33: 		// Reasoning deltas
34: 		if (
35: 			event?.type === "response.reasoning_text.delta" ||
36: 			event?.type === "response.reasoning.delta" ||
37: 			event?.type === "response.reasoning_summary_text.delta" ||
38: 			event?.type === "response.reasoning_summary.delta"
39: 		) {
40: 			if (event?.delta) {
41: 				yield { type: "reasoning", text: event.delta }
42: 			}
43: 			continue
44: 		}
45: 
```

## O14: RooCodeInc/Roo-Code / webview-ui/src/components/chat/ReasoningBlock.tsx

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/webview-ui/src/components/chat/ReasoningBlock.tsx)

原文件 18–44 行：

```text
18: 	const { t } = useTranslation()
19: 	const { reasoningBlockCollapsed } = useExtensionState()
20: 
21: 	const [isCollapsed, setIsCollapsed] = useState(reasoningBlockCollapsed)
22: 
23: 	const startTimeRef = useRef<number>(Date.now())
24: 	const [elapsed, setElapsed] = useState<number>(0)
25: 	const contentRef = useRef<HTMLDivElement>(null)
26: 
27: 	useEffect(() => {
28: 		setIsCollapsed(reasoningBlockCollapsed)
29: 	}, [reasoningBlockCollapsed])
30: 
31: 	useEffect(() => {
32: 		if (isLast && isStreaming) {
33: 			const tick = () => setElapsed(Date.now() - startTimeRef.current)
34: 			tick()
35: 			const id = setInterval(tick, 1000)
36: 			return () => clearInterval(id)
37: 		}
38: 	}, [isLast, isStreaming])
39: 
40: 	const seconds = Math.floor(elapsed / 1000)
41: 	const secondsLabel = t("chat:reasoning.seconds", { count: seconds })
42: 
43: 	const handleToggle = () => {
44: 		setIsCollapsed(!isCollapsed)
```

原文件 70–77 行：

```text
70: 					ref={contentRef}
71: 					className="border-l border-vscode-descriptionForeground/20 ml-2 pl-4 pb-1 text-vscode-descriptionForeground break-words">
72: 					<MarkdownBlock markdown={content} />
73: 				</div>
74: 			)}
75: 		</div>
76: 	)
77: }
```

## O15: RooCodeInc/Roo-Code / src/core/condense/index.ts

[固定源码](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/condense/index.ts)

原文件 323–339 行：

```text
323: 	let summary = ""
324: 	let cost = 0
325: 	let outputTokens = 0
326: 
327: 	try {
328: 		const stream = apiHandler.createMessage(promptToUse, requestMessages, metadata)
329: 
330: 		for await (const chunk of stream) {
331: 			if (chunk.type === "text") {
332: 				summary += chunk.text
333: 			} else if (chunk.type === "usage") {
334: 				// Record final usage chunk only
335: 				cost = chunk.totalCost ?? 0
336: 				outputTokens = chunk.outputTokens ?? 0
337: 			}
338: 		}
339: 	} catch (error) {
```

原文件 451–480 行：

```text
451: 	const summaryMessage: ApiMessage = {
452: 		role: "user", // Fresh start model: summary is a user message
453: 		content: summaryContent,
454: 		ts: lastMsgTs + 1, // Unique timestamp after last message
455: 		isSummary: true,
456: 		condenseId, // Unique ID for this summary, used to track which messages it replaces
457: 	}
458: 
459: 	// NON-DESTRUCTIVE CONDENSE:
460: 	// Tag ALL existing messages with condenseParent so they are filtered out when
461: 	// the effective history is computed. The summary message is the only message
462: 	// that will be visible to the API after condensing (fresh start model).
463: 	//
464: 	// Storage structure after condense:
465: 	// [msg1(parent=X), msg2(parent=X), ..., msgN(parent=X), summary(id=X)]
466: 	//
467: 	// Effective for API (filtered by getEffectiveApiHistory):
468: 	// [summary]  ← Fresh start!
469: 
470: 	// Tag ALL messages with condenseParent
471: 	const newMessages = messages.map((msg) => {
472: 		// If message already has a condenseParent, we leave it - nested condense is handled by filtering
473: 		if (!msg.condenseParent) {
474: 			return { ...msg, condenseParent: condenseId }
475: 		}
476: 		return msg
477: 	})
478: 
479: 	// Append the summary message at the end
480: 	newMessages.push(summaryMessage)
```

## O16: cline/cline / sdk/packages/llms/src/providers/ai-sdk.ts

[固定源码](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/sdk/packages/llms/src/providers/ai-sdk.ts)

原文件 1434–1450 行：

```text
1434: 				if (part.type === "reasoning-delta" || part.type === "reasoning") {
1435: 					const text =
1436: 						(part.textDelta as string | undefined) ??
1437: 						(part.text as string | undefined) ??
1438: 						(part.reasoning as string | undefined);
1439: 					if (text) {
1440: 						sawVisibleContent = true;
1441: 						yield {
1442: 							type: "reasoning-delta",
1443: 							text,
1444: 							metadata: extractGoogleThoughtMetadata(part),
1445: 						};
1446: 					}
1447: 					continue;
1448: 				}
1449: 
1450: 				if (part.type === "file") {
```

## O17: cline/cline / apps/vscode/src/sdk/message-translator.ts

[固定源码](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/src/sdk/message-translator.ts)

原文件 1291–1308 行：

```text
1291: 				case "reasoning": {
1292: 					// SDK reasoning content_start events are deltas. The webview renders
1293: 					// reasoning from `text`, so keep `text` and `reasoning` populated with
1294: 					// the accumulated content for smooth in-place streaming.
1295: 					const ts = state.getStreamingReasoningTs()
1296: 					const reasoning = state.appendStreamingReasoning(event.reasoning ?? "")
1297: 					messages.push({
1298: 						ts,
1299: 						type: "say",
1300: 						say: "reasoning",
1301: 						text: reasoning,
1302: 						reasoning,
1303: 						partial: true,
1304: 					})
1305: 					break
1306: 				}
1307: 				case "tool": {
1308: 					const toolName = event.toolName ?? "unknown"
```

## O18: cline/cline / apps/vscode/webview-ui/src/components/chat/ChatRow.tsx

[固定源码](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/webview-ui/src/components/chat/ChatRow.tsx)

原文件 884–903 行：

```text
884: 					case "reasoning": {
885: 						const isReasoningStreaming = message.partial === true
886: 						const hasReasoningText = !!message.text?.trim()
887: 						// Show feature tips throughout the entire thinking/reasoning phase
888: 						const _showFeatureTip = isReasoningStreaming
889: 						return (
890: 							<div>
891: 								<ThinkingRow
892: 									isExpanded={(isReasoningStreaming && hasReasoningText) || isExpanded}
893: 									isStreaming={isReasoningStreaming}
894: 									isVisible={true}
895: 									onToggle={isReasoningStreaming ? undefined : handleToggle}
896: 									reasoningContent={message.text}
897: 									showChevron={!isReasoningStreaming || hasReasoningText}
898: 									showTitle={true}
899: 									title={isReasoningStreaming ? "Thinking..." : "Thinking"}
900: 								/>
901: 								{isReasoningStreaming && showFeatureTips === true && <FeatureTip />}
902: 							</div>
903: 						)
```

## O19: cline/cline / apps/vscode/webview-ui/src/components/chat/ThinkingRow.tsx

[固定源码](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/apps/vscode/webview-ui/src/components/chat/ThinkingRow.tsx)

原文件 88–113 行：

```text
88: 
89: 				{isExpanded && (
90: 					<Button
91: 						className={cn(
92: 							"flex gap-0 overflow-hidden w-full min-w-0 max-h-0 opacity-0 items-baseline justify-baseline text-left !p-0 !pl-0",
93: 							"disabled:cursor-text disabled:opacity-100",
94: 							{
95: 								"max-h-[200px] opacity-100": isVisible,
96: 								"transition-[max-height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] [transition:max-height_250ms_cubic-bezier(0.4,0,0.2,1),opacity_150ms_ease-out]":
97: 									isVisible,
98: 							},
99: 						)}
100: 						disabled={!showTitle}
101: 						onClick={onToggle}
102: 						variant="text">
103: 						<div className="relative flex-1">
104: 							<div
105: 								className={cn(
106: 									"flex max-h-[150px] overflow-y-auto text-description leading-normal truncated whitespace-pre-wrap break-words pl-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [direction:ltr]",
107: 								)}
108: 								onScroll={checkScrollable}
109: 								ref={scrollRef}>
110: 								<span className="pb-2 block text-sm">{reasoningContent}</span>
111: 							</div>
112: 							{canScrollUp && (
113: 								<div className="absolute top-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-b from-background to-transparent" />
```

## O20: cline/cline / sdk/packages/core/src/extensions/context/agentic-compaction.ts

[固定源码](https://github.com/cline/cline/blob/40f1d75bd2502f4f872e509496c102ccaa43abf3/sdk/packages/core/src/extensions/context/agentic-compaction.ts)

原文件 70–110 行：

```text
70: async function generateSummary(options: {
71: 	providerConfig: ProviderConfig;
72: 	request: string;
73: 	logger?: BasicLogger;
74: }): Promise<SummaryGenerationResult> {
75: 	const handler = await createHandlerAsync(options.providerConfig);
76: 	let text = "";
77: 	let reasoningChars = 0;
78: 	let incompleteReason: string | undefined;
79: 	for await (const chunk of handler.createMessage(
80: 		"Summarize the provided coding session into a concise continuation note with detailed next steps.",
81: 		[{ role: "user", content: options.request }],
82: 	)) {
83: 		if (chunk.type === "text") {
84: 			text += chunk.text;
85: 			continue;
86: 		}
87: 		if (chunk.type === "reasoning") {
88: 			reasoningChars += chunk.reasoning?.length ?? 0;
89: 			continue;
90: 		}
91: 		if (chunk.type === "done") {
92: 			if (!chunk.success && chunk.error) {
93: 				throw new Error(chunk.error);
94: 			}
95: 			incompleteReason = chunk.incompleteReason ?? incompleteReason;
96: 		}
97: 	}
98: 	options.logger?.debug("Generated compaction summary", {
99: 		outputChars: text.length,
100: 		reasoningChars,
101: 		incompleteReason,
102: 		modelId: options.providerConfig.modelId,
103: 		providerId: options.providerConfig.providerId,
104: 	});
105: 	return { text: text.trim(), reasoningChars, incompleteReason };
106: }
107: 
108: function safeJsonSize(value: unknown): number {
109: 	try {
110: 		return JSON.stringify(value).length;
```

原文件 253–292 行：

```text
253: 	const summaryResult = await generateSummary({
254: 		providerConfig: summarizerProviderConfig,
255: 		request: summaryRequest,
256: 		logger: options.logger,
257: 	});
258: 	const rawSummary = summaryResult.text;
259: 	if (!rawSummary) {
260: 		options.logger?.log(
261: 			"Skipped agentic compaction: summarizer returned no summary text",
262: 			{
263: 				severity: "warn",
264: 				summarizerProviderId: summarizerProviderConfig.providerId,
265: 				summarizerModelId: summarizerProviderConfig.modelId,
266: 				summarizerMaxOutputTokens: summarizerProviderConfig.maxOutputTokens,
267: 				reasoningChars: summaryResult.reasoningChars,
268: 				incompleteReason: summaryResult.incompleteReason,
269: 				likelyCause:
270: 					summaryResult.reasoningChars > 0
271: 						? "output_budget_consumed_by_reasoning"
272: 						: "empty_response",
273: 			},
274: 		);
275: 		return undefined;
276: 	}
277: 
278: 	const summary = ensureFilesSection(rawSummary, fileOps);
279: 	const tokensBefore = messages.reduce(
280: 		(total, message) => total + options.estimateMessageTokens(message),
281: 		0,
282: 	);
283: 	const resultMessages = [
284: 		buildSummaryMessage({
285: 			summary,
286: 			fileOps,
287: 			tokensBefore,
288: 			userRunSpan: countUserRunMessages(messagesToSummarize),
289: 		}),
290: 		...messages.slice(cutIndex),
291: 	];
292: 	const tokensAfter = resultMessages.reduce(
```

## O21: open-webui/open-webui / src/lib/components/chat/Messages/structuredOutput.ts

[固定源码](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/src/lib/components/chat/Messages/structuredOutput.ts)

原文件 238–255 行：

```text
238: function buildReasoningToken(item: OutputItem, isLastItem: boolean) {
239: 	const duration = item.duration ?? '';
240: 	const isDone = isDoneStatus(item.status) || item.duration !== undefined || !isLastItem;
241: 	const text = getReasoningText(item)
242: 		.split('\n')
243: 		.map((line) => (line.startsWith('>') ? line : `> ${line}`))
244: 		.join('\n');
245: 
246: 	return {
247: 		summary: isDone ? `Thought for ${duration || 0} seconds` : 'Thinking...',
248: 		text,
249: 		attributes: {
250: 			type: 'reasoning',
251: 			done: isDone ? 'true' : 'false',
252: 			duration: String(duration)
253: 		}
254: 	};
255: }
```

原文件 609–617 行：

```text
609: 		if (deltaType === 'reasoning_summary_text') {
610: 			const summaryIndex = event.summary_index ?? 0;
611: 			item.summary = [...(item.summary ?? [])];
612: 			const part = ensurePart(item.summary, summaryIndex, { type: 'summary_text', text: '' });
613: 			part.text = appendDelta(part.text ?? '', event.delta);
614: 			return nextOutput;
615: 		}
616: 
617: 		const key = deltaType === 'output_text' || deltaType === 'reasoning_text' ? 'text' : deltaType;
```

## O22: openai/codex / codex-rs/core/src/client.rs

[固定源码](https://github.com/openai/codex/blob/38cbebaf3fe3e81a94bf462079e7cf9659fc9e50/codex-rs/core/src/client.rs)

原文件 870–888 行：

```text
870:     fn build_reasoning(
871:         &self,
872:         model_info: &ModelInfo,
873:         effort: Option<ReasoningEffortConfig>,
874:         summary: ReasoningSummaryConfig,
875:     ) -> Reasoning {
876:         Reasoning {
877:             effort: effort
878:                 .or_else(|| model_info.default_reasoning_level.clone())
879:                 .map(|effort| model_info.resolve_reasoning_effort(effort)),
880:             summary: (model_info.supports_reasoning_summary_parameter
881:                 && summary != ReasoningSummaryConfig::None)
882:                 .then_some(summary),
883:             // When Responses Lite is disabled, omit context so Responses uses the default,
884:             // which is currently `current_turn`.
885:             context: model_info
886:                 .use_responses_lite
887:                 .then_some(ReasoningContext::AllTurns),
888:         }
```

## O23: openai/codex / codex-rs/codex-api/src/sse/responses.rs

[固定源码](https://github.com/openai/codex/blob/38cbebaf3fe3e81a94bf462079e7cf9659fc9e50/codex-rs/codex-api/src/sse/responses.rs)

原文件 381–388 行：

```text
381:         "response.reasoning_summary_text.delta" => {
382:             if let (Some(delta), Some(summary_index)) = (event.delta, event.summary_index) {
383:                 return Ok(Some(ResponseEvent::ReasoningSummaryDelta {
384:                     delta,
385:                     summary_index,
386:                 }));
387:             }
388:         }
```
