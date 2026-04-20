# Zotero Agent 设计文档

> 版本: 0.1.0 (Draft)
> 更新: 2026-04-20

## 1. 产品定位

**一句话描述**: Zotero 中的 AI 研究助手，像 VS Code Copilot Chat 一样，通过对话完成论文搜索、下载、阅读和分析。

**目标用户**: 科研人员、研究生、需要大量阅读文献的知识工作者

## 2. 交互方式

### 2.1 主界面：对话框 (Chat Panel)

参考 VS Code 的 Copilot Chat，在 Zotero 侧边栏或浮动窗口中提供对话界面。

```
┌─────────────────────────────────────┐
│  🤖 Zotero Agent                  ─ □ ×│
├─────────────────────────────────────┤
│                                     │
│  User: 帮我找最近关于 LLM Agent     │
│        的论文                       │
│                                     │
│  Agent: 正在搜索 arXiv 和            │
│         Semantic Scholar...         │
│                                     │
│  📄 [1] ReAct: Synergizing...       │
│     ⭐ 2.3k citations | 2023        │
│     [下载 PDF] [添加到库]           │
│                                     │
│  📄 [2] AutoGPT: An Autonomous...   │
│     ⭐ 1.8k citations | 2023        │
│     [下载 PDF] [添加到库]           │
│                                     │
│  User: 总结第一篇的核心方法          │
│                                     │
│  Agent: ReAct 的核心思想是...       │
│                                     │
├─────────────────────────────────────┤
│  [输入消息...]              [发送]  │
└─────────────────────────────────────┘
```

### 2.2 交互模式

| 模式 | 触发方式 | 说明 |
|------|----------|------|
| 全局对话 | 点击工具栏图标 / 快捷键 | 打开对话框 |
| 上下文对话 | 右键选中条目 → "Ask Agent" | 基于选中论文提问 |
| PDF 内对话 | 在 PDF 阅读器中选中文字 → "Ask Agent" | 基于选中内容提问 |

### 2.3 斜杠命令 (Slash Commands)

```
/search <query>      - 搜索论文
/download <url>      - 下载 PDF 并导入
/summarize           - 总结当前选中的论文
/explain <text>      - 解释选中的内容
/translate           - 翻译选中的内容
/related             - 查找相关论文
/cite                - 生成引用格式
/ask <question>      - 基于论文内容提问 (RAG)
/settings            - 打开设置
```

## 3. 核心功能

### 3.1 论文搜索

**数据源**:

| 来源 | API | 说明 |
|------|-----|------|
| arXiv | arxiv.org/api | 预印本，免费全文 |
| Semantic Scholar | api.semanticscholar.org | 引用数据丰富 |
| CrossRef | api.crossref.org | DOI 元数据 |
| Google Scholar | (需爬虫) | 覆盖广，但无官方 API |

**搜索流程**:

```
用户输入
    ↓
查询理解 (LLM 提取关键词/时间范围/领域)
    ↓
并行查询多个数据源
    ↓
结果去重 + 排序 (按相关性/引用数/时间)
    ↓
展示给用户
```

### 3.2 PDF 下载

**下载源优先级**:

1. arXiv (免费)
2. Unpaywall (开放获取)
3. 出版商官网 (需订阅)
4. Sci-Hub (备选，用户自行配置)

**下载流程**:

```
获取论文元数据 (DOI/arXiv ID)
    ↓
尝试从优先级高的源下载
    ↓
下载成功 → 导入 Zotero
    ↓
自动提取元数据 + 关联 PDF
```

### 3.3 RAG 问答 (类 zotero-gpt)

**流程**:

```
PDF → 解析文本 → 分段 (Chunking)
                    ↓
              Embedding → 本地向量存储
                    ↓
用户提问 → Query Embedding → 相似度搜索
                    ↓
            取 Top-K 相关段落
                    ↓
            拼接 Prompt → LLM → 回答
```

**Embedding 方案**:

| 方案 | 价格 | 延迟 | 推荐场景 |
|------|------|------|----------|
| 豆包 API | ¥0.5/百万 | 低 | 默认方案 (已有账号) |
| 本地 BGE | 免费 | 中 | 离线/隐私敏感 |

**向量存储**:
- 本地 JSON 文件 (简单，小规模)
- IndexedDB (浏览器内置，中等规模)

### 3.4 文献总结/翻译

复用 RAG 基础设施，针对不同任务设计 Prompt：

| 功能 | Prompt 策略 |
|------|-------------|
| 总结 | 提取摘要+结论，要求精炼 |
| 翻译 | 学术风格翻译 |
| 解释 | 用简单语言解释概念 |
| 相关工作 | 基于当前论文查找相关论文 |

## 4. 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    Zotero Agent                     │
├─────────────────────────────────────────────────────┤
│  UI Layer                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Chat Panel  │  │ Search View │  │  Settings   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────┤
│  Service Layer                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Search    │  │  Download   │  │     RAG     │ │
│  │   Service   │  │   Service   │  │   Service   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────┤
│  Integration Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ arXiv API   │  │ Semantic    │  │  LLM API    │ │
│  │             │  │ Scholar API │  │ (Doubao)    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────┤
│  Storage Layer                                      │
│  ┌─────────────┐  ┌─────────────┐                  │
│  │  Embedding  │  │   Config    │                  │
│  │   Cache     │  │   Storage   │                  │
│  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────┘
```

## 5. 目录结构 (规划)

```
src/
├── index.ts                 # 入口
├── hooks.ts                 # 生命周期
├── addon.ts                 # 插件基类
│
├── ui/                      # UI 组件
│   ├── ChatPanel.ts         # 对话面板
│   ├── SearchResultView.ts  # 搜索结果
│   └── SettingsPane.ts      # 设置页
│
├── services/                # 业务逻辑
│   ├── SearchService.ts     # 搜索服务
│   ├── DownloadService.ts   # 下载服务
│   ├── RAGService.ts        # RAG 服务
│   └── LLMService.ts        # LLM 调用
│
├── integrations/            # 外部 API 集成
│   ├── ArxivAPI.ts
│   ├── SemanticScholarAPI.ts
│   ├── DoubaoAPI.ts
│   └── EmbeddingAPI.ts
│
├── storage/                 # 存储
│   ├── EmbeddingCache.ts
│   └── ConfigStorage.ts
│
└── utils/                   # 工具函数
    ├── pdf.ts               # PDF 解析
    ├── chunking.ts          # 文本分段
    └── similarity.ts        # 相似度计算
```

## 6. 配置项

```typescript
interface AgentConfig {
  // LLM 设置
  llm: {
    provider: 'doubao' | 'openai' | 'custom';
    apiKey: string;
    apiBase: string;
    model: string;
  };

  // Embedding 设置
  embedding: {
    provider: 'doubao' | 'openai' | 'local';
    apiKey?: string;
    model?: string;
  };

  // 搜索设置
  search: {
    sources: ('arxiv' | 'semanticscholar' | 'crossref')[];
    maxResults: number;
    defaultSort: 'relevance' | 'citations' | 'date';
  };

  // 下载设置
  download: {
    preferOpenAccess: boolean;
    scihubMirror?: string;  // 用户自行配置
  };

  // RAG 设置
  rag: {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
  };
}
```

## 7. 开发计划

### Phase 1: MVP (1 周)

- [ ] 基础 UI: 对话框 + 输入框
- [ ] arXiv 搜索
- [ ] PDF 下载 + 导入 Zotero
- [ ] 基础对话 (无 RAG)

### Phase 2: RAG (1 周)

- [ ] PDF 解析 + 分段
- [ ] Embedding 生成 + 缓存
- [ ] 相似度搜索
- [ ] 基于文档的问答

### Phase 3: 完善 (1 周)

- [ ] 多数据源搜索
- [ ] 斜杠命令
- [ ] 设置页面
- [ ] 错误处理 + 用户体验优化

## 8. 参考

- [zotero-gpt](https://github.com/MuiseDestiny/zotero-gpt) - RAG 实现参考
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) - 插件模板
- [seerai](https://github.com/dralkh/seerai) - Semantic Scholar 集成参考
