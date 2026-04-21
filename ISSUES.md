# Zotero Agent - Issues & Solutions

## 2026-04-21: Function Calling 架构重构

### 问题：双重 LLM 调用，架构不合理

**问题描述**:

旧架构有两次独立的 LLM 调用：
```
用户输入 → [LLM 1: 意图分析] → 执行工具 → [LLM 2: 工具内部生成回复]
```

具体表现：
1. `ToolRegistry` 先调 `IntentAnalyzer` 分析意图（第 1 次 LLM）
2. 确定工具后，如 `PaperQATool.execute()` 内部又调 LLM（第 2 次 LLM）
3. 对话历史被传了两次，浪费 token
4. 两次调用不在同一个会话，上下文割裂

**根本原因**:

工具设计不符合 Function Calling 最佳实践。工具不应该内部调用 LLM，而应该只返回数据。

**解决方案**:

重构为标准 Function Calling 架构：
```
用户输入 + 工具定义 → [LLM: 单次调用]
                         ├─ 需要数据 → tool_calls → 工具返回数据
                         └─ 基于数据生成回答
```

**改动文件**:
- 新建 `src/tools/DataTools.ts` - 纯数据工具
- 重写 `src/tools/ToolUseRegistry.ts` - 标准 Function Calling 流程
- 保留 `src/tools/QATools.ts` 作为 legacy

**参考**: Claude Code 的所有工具（Read, Grep, Bash 等）都只返回数据，不内部调 LLM。

---

### 问题："历史限制 10 条" 的困惑

**问题描述**:

代码中 `chatHistory.slice(-10)` 限制只传最近 10 条历史，但用户困惑：既然是"伪多轮"（每次都传完整历史），为什么要限制？

**原因分析**:

这是旧架构的遗留设计：
1. 旧 `IntentAnalyzer` 只需要理解"用户想干什么"，不需要完整历史
2. 担心历史太长超出 token 限制
3. 但在新架构下，LLM 需要看到完整历史才能正确回答

**解决方案**:

新架构中移除了历史限制，让 LLM 自己管理上下文。

---

### 问题：LLM API 的"伪多轮"本质

**问题描述**:

用户问"用户和 agent 的多轮交流，对应的 LLM API 是多轮交流吗？"

**澄清**:

不是真正的多轮。OpenAI 兼容 API 都是"伪多轮"设计：

| 轮次 | API 调用内容 |
|------|-------------|
| 第 1 轮 | `[system, user1]` |
| 第 2 轮 | `[system, user1, assistant1, user2]` |
| 第 3 轮 | `[system, user1, assistant1, user2, assistant2, user3]` |

每次都是新的 HTTP 请求，历史消息作为 `messages` 数组传入。服务端无状态，客户端维护历史。

---

## TODO

### 意图分析改进
- [x] 重构为 Harness + LLM 架构 (`IntentAnalyzer.ts`)
- [x] 硬约束规则优先检查，只保留明确的（如"下载 1"、"之前/刚才"）
- [x] LLM 分析增加对话历史摘要
- [x] 返回 confidence + source 字段
- [ ] 低置信度时询问用户确认（待实现 UI）

### Harness Engineering (缰绳工程)

参考: https://openai.com/zh-Hans-CN/index/harness-engineering/

核心理念：为 AI Agent 添加约束和控制机制，就像给马套上缰绳。

**实现架构** (`src/tools/IntentAnalyzer.ts`):

```
用户输入
    ↓
Phase 1: Harness Rules (硬约束)
    ├─ 匹配 → 直接返回 (confidence=1.0, source="harness")
    └─ 不匹配 ↓
Phase 2: LLM Analysis (软约束)
    ├─ 成功 → 返回 (confidence=0.x, source="llm")
    └─ 失败 ↓
Phase 3: Fallback (兜底)
    └─ 返回 (confidence<0.5, source="fallback")
```

**硬约束规则示例** (HARNESS_RULES):
```typescript
{
  name: "download_command",
  match: /下载\s*(?:第?\s*)?(\d+)/,
  tool: "arxiv_download",
  confidence: 1.0,
  priority: 100,  // 最高优先级
}
```

关键设计：
1. **优先级排序** - priority 越高越先检查
2. **match + exclude** - 同时支持匹配和排除模式
3. **contextCheck** - 可检查上下文条件（如是否有选中文本）
4. **confidence** - 每个结果带置信度，便于后续决策
5. **source** - 标记来源，便于调试

### 反思：硬约束的边界

**结论：只有斜杠命令才需要硬编码**

| 类型 | 例子 | 处理方式 |
|------|------|----------|
| 斜杠命令 | `/download 1`, `/help` | 硬编码解析 |
| 自然语言 | "下载 1", "下载第一篇" | 全部交给 LLM |

原因：
- 用户输入 `/download 1` 时，**知道**自己在调用命令
- 用户输入 "下载 1" 时，是用**自然语言表达意图**，LLM 更擅长理解变体

---

## 架构参考：Claude Code 的 Agent + Tools

### Claude Code 为什么不用 RAG？

Claude Code 没有传统 RAG（向量化 + 语义检索），而是用 **Agent + Tools**：

```
用户: "认证是怎么实现的？"
    ↓
LLM 决定需要什么信息
    ↓
调用 Grep 工具: 搜索 "auth", "login"
    ↓
调用 Read 工具: 读取 src/auth.ts:20-50
    ↓
LLM 基于读取的内容回答
```

**对比：**

| 方面 | RAG | Agent + Tools |
|------|-----|---------------|
| 预处理 | 切块 → 向量化 → 存储 | 无 |
| 检索方式 | 语义相似度 | Glob + Grep |
| 更新成本 | 代码改了要重新索引 | 无，实时读取 |
| 精确性 | 可能召回无关内容 | 精确匹配 |

**为什么代码场景适合 Agent + Tools：**
1. 代码有明确命名，关键词搜索够用
2. 代码变化快，向量化索引成本高
3. 可以精确定位到 `file.ts:42`

### 论文场景为什么不同？

**PDF 没有"行号"概念：**

| 方面 | 代码文件 | PDF |
|------|---------|-----|
| 存储方式 | 纯文本，按行 | 页面描述，(x,y) 坐标 |
| 搜索结果 | `file.ts:42` | "第3页大概位置" |
| 文本提取 | 原样读取 | 可能乱序、丢格式 |

**论文 PDF 的问题：**
- 双栏排版 → 提取文本顺序混乱
- 公式 → 变成乱码
- 表格/图表 → 无法正确提取

**结论：论文场景可能更适合 RAG 或结构化解析（如 Grobid），而不是 Claude Code 的 Grep 模式。**

### Tool Use vs 意图分析

当前 zotero-agent 是两次 LLM 调用：
```
用户输入 → [LLM 1: 意图分析] → 执行工具 → [LLM 2: 生成回复]
```

更好的方案是 **Tool Use / Function Calling**：
```
用户输入 + 工具定义 → [LLM: 一次调用]
                         ├─ 决定调用什么工具
                         ├─ 生成工具参数
                         └─ 生成回复
```

优势：一次调用，无额外延迟，LLM 有完整上下文。

---

## 2026-04-21

### 1. arXiv API 429 错误 (Rate Limit)

**问题**: arXiv 搜索返回 HTTP 429 错误，提示请求频率过高。

**原因**:
- arXiv 官方限制 API 请求频率（同一 IP 连续请求需间隔 3 秒）
- 之前的请求可能已触发限制，需要等待才能解除

**解决方案**:
1. 添加自动重试机制（最多 2 次，间隔 5s、10s）
2. 改用原生 XMLHttpRequest 代替 Zotero.HTTP.request
3. 设置合适的 User-Agent header
4. 友好的错误提示

**相关文件**: `src/services/ArxivService.ts`

---

### 2. 意图分析误判历史对话问题

**问题**: 用户问"你之前搜索返回了几篇"，Agent 误以为要去搜索，而不是回答关于历史对话的问题。

**原因**: 意图分析的关键词匹配把"搜索"识别成了 arxiv_search，没有识别"之前"、"刚才"等指向历史对话的词。

**解决方案**: 在意图分析中添加优先检查，如果包含"之前"、"刚才"、"返回了几"等词，且不包含"去搜索"、"帮我搜"，则走 general_qa（会使用对话历史）。

**相关文件**: `src/tools/ToolRegistry.ts`

---

### 3. LLM 输出格式不一致

**问题**: 多篇论文总结时，不同论文的格式不一致（有的用粗体，有的不用）。

**原因**: LLM 随机性，同样的 prompt 不同次调用可能产生不同格式。

**解决方案**: 在 prompt 中明确要求格式统一：
- "每篇用相同格式：论文N：一句话概括"
- "请保持各部分格式统一，避免对某些论文使用粗体/标题而其他不用"

**相关文件**: `src/tools/SummarizeTool.ts`

---

### 4. 浮动图标在窗口缩小后消失

**问题**: 最大化时图标正常，缩小窗口后图标跑到窗口外面看不到了。

**原因**: 图标位置被保存，但窗口缩小时没有检查边界。

**解决方案**:
1. 初始化时检查保存的位置是否在窗口范围内
2. 监听 window resize 事件，动态调整图标位置到可见区域

**相关文件**: `src/modules/sidePanel.ts`

---

### 5. 对话历史未传递给 LLM

**问题**: Agent 不记得之前的对话内容（如"我刚才给了你几篇论文"）。

**原因**: QA 工具调用 LLM 时没有包含对话历史。

**解决方案**:
1. 定义 `ChatMessage` 和 `MessageContext` 类型保存对话上下文
2. QA 工具从 context.chatHistory 构建历史消息
3. 将历史消息 + 当前问题一起发送给 LLM

**相关文件**:
- `src/types/context.ts`
- `src/tools/QATools.ts`
