// Authored synthetic fixtures for protocol isolation and failure exploration.
// NOT sampled model traces, benchmark tasks, or evidence of model quality.
export const fixtures = [
  { id: 'duplicate-request', domain: 'coding', language: 'zh', text: '请求出现了两次，需要先检查调用入口。\n\n组件挂载和用户点击都可能触发同一个请求。组件挂载期间会执行 effect。依赖数组变化也会重新执行 effect。\n\n目前没有证据证明服务端重试造成了重复请求。先记录两次调用的来源，再决定应该修改哪一个触发点。' },
  { id: 'negation', domain: 'coding', language: 'en', text: 'A cache issue is one possible explanation. The cache stores the response. A cache key could be incorrect. Cache keys are shared by both paths.\n\nThe new trace rules out the cache; the duplicate comes from two listeners. Do not remove caching.\n\nI will add a test that counts request invocations.' },
  { id: 'math', domain: 'math', language: 'zh', text: '需要求解整数约束，而不是对小数结果直接四舍五入。\n\n先把总数量代入第二个方程。消元后得到一个候选整数解。\n\n候选解还要满足各项非负的条件。代回两个原方程后，才能确认这个解有效。' },
  { id: 'research', domain: 'research', language: 'en', text: 'The published figures use different reporting periods.\n\nI will compare the original reports before calculating growth. The annual figure cannot be directly compared with the quarterly figure.\n\nThe older report does not disclose the same denominator. A numerical growth claim is not supported yet.' },
  { id: 'unknown-tool', domain: 'novel tool', language: 'zh', text: '需要检查轨道预测和观测是否使用同一时间基准。\n\n准备调用 orbit_epoch_reconcile，核对输入中的历元。这个工具名称本身不能说明观测偏差的原因。\n\n如果时间基准一致，再比较残差分布。目前只能确认检查顺序，尚不能确认原因。' },
  { id: 'contract', domain: 'document review', language: 'en', text: 'The renewal clause refers to notice before the end of the term.\n\nThe attached amendment changes the notice period. The original agreement alone is therefore insufficient.\n\nI will quote the amendment together with the relevant original clause. The effective date remains unverified.' },
  { id: 'plan', domain: 'planning', language: 'zh', text: '发布计划受到审核窗口和人员安排两个条件限制。\n\n先确认审核是否必须在发布前完成。人员有空并不代表审核已完成。\n\n可以先准备发布材料，但实际发布时间要等审核窗口确认。' },
  { id: 'mixed-code', domain: 'coding', language: 'mixed', text: 'The failure occurs after reconnect，先检查连接恢复时的订阅。\n\n`subscribe()` returns an unsubscribe function. 需要确认重连前是否调用了这个清理函数。\n\n现有日志只有订阅次数，没有清理次数。下一步增加可关联的记录，再验证是否存在泄漏。' },
  { id: 'long-sentence', domain: 'unstructured', language: 'zh', text: '这是一个没有原生标题而且句子很长的推理片段，其中同时包含约束、候选方法和暂时无法确认的事实，仅仅从这个句子中选择几个词不能保证读者理解完整语境，也不能保证把专业术语解释清楚，所以需要保留可回到原文的入口并诚实标记摘录的性质。' },
  { id: 'already-clear', domain: 'plain language', language: 'zh', text: '这个请求被重复执行了。\n\n我会找到重复触发的位置，把它改成只执行一次。' },
  { id: 'jargon', domain: 'systems', language: 'en', text: 'The linearization point is after the CAS.\n\nAn ABA transition can invalidate the observed version despite pointer equality. Hazard pointers may protect reclamation, but do not by themselves prove the update linearizable.\n\nWe need a minimal counterexample before selecting an epoch-based scheme.' },
  { id: 'unicode', domain: 'unicode', language: 'mixed', text: '🧭 首先确认 Café 的数据来源。\n\nThe label uses e\u0301 rather than a single precomposed character.\n\n展示层不能改变回传的 Unicode 内容。Keep the original byte sequence.' },
];
