# Zotero Agent：搜论文、下论文、问论文，一个插件全搞定

> 做科研最烦的事：开着 arXiv 搜论文，开着 Zotero 管文献，开着 ChatGPT 问问题。三个窗口来回切，效率全浪费在 Alt+Tab 上了。

---

## 痛点

作为一个经常读论文的人，我的工作流是这样的：

1. 去 arXiv/PubMed 搜论文
2. 找到想要的，下载 PDF
3. 拖进 Zotero，整理元数据
4. 打开 PDF，看不懂的地方复制出来
5. 切到 ChatGPT，粘贴，问问题
6. 循环往复...

**太累了。**

于是我做了 Zotero Agent —— 把搜索、下载、问答全部塞进 Zotero 侧边栏。一个对话框，搞定所有事。

---

## 它能做什么？

### 1. 搜论文 + 一键下载（独有功能）

直接在对话框里说"帮我搜 transformer attention 相关的论文"：

![论文搜索下载](图片链接)

AI 会帮你搜索，列出结果，点击就能下载到 Zotero。**不用开浏览器，不用手动拖文件。**

目前支持：
- **arXiv** —— CS/Physics/Math 等领域
- **PubMed** —— 生物医学领域（自动尝试从 PMC 或 Unpaywall 获取免费 PDF）

### 2. 论文问答

选中一篇论文，直接问：

- "这篇论文的核心贡献是什么？"
- "用中文总结一下摘要"
- "这个方法和 XXX 有什么区别？"

![论文问答](图片链接)

### 3. PDF 选中即问

看 PDF 看到一段看不懂的公式/术语？选中它，在侧边栏直接问：

![PDF选中解读](图片链接)

不用复制粘贴，不用切窗口。

### 4. 支持国内模型，无需翻墙

- **豆包**（推荐，新用户送 50 万 tokens）
- **DeepSeek**（便宜）
- **通义千问**
- 任何兼容 OpenAI API 的服务

---

## 和 Zotero-GPT 有什么区别？

| 功能 | Zotero Agent | Zotero-GPT |
|------|:------------:|:----------:|
| AI 论文问答 | ✅ | ✅ |
| **arXiv 搜索下载** | ✅ | ❌ |
| **PubMed 搜索下载** | ✅ | ❌ |
| 国内模型支持 | ✅ | ✅ |
| 无需翻墙 | ✅ | 取决于模型 |

简单说：**Zotero Agent = Zotero-GPT + 论文搜索下载**

---

## 安装（3 分钟）

### 第一步：安装插件

1. 下载 [zotero-agent.xpi](GitHub Release 链接)
2. Zotero → `工具` → `插件`
3. 点击 ⚙️ → `Install Plugin From File...` → 选择 xpi 文件

### 第二步：配置 AI

点击右下角图标打开对话框，输入以下命令：

**方案一：豆包（推荐）**
```
/apibase https://ark.cn-beijing.volces.com/api/v3
/apikey 你的密钥
/model doubao-seed-2-0-pro-260215
```

**方案二：DeepSeek（便宜）**
```
/apibase https://api.deepseek.com
/apikey 你的密钥
/model deepseek-chat
```

输入 `/config` 确认配置成功。

---

## 实际使用场景

### 场景一：快速调研一个新领域

> "帮我搜最近关于 RLHF 的论文，下载引用最高的 5 篇"

AI 搜索 → 你挑选 → 一键下载 → 自动整理到 Zotero

### 场景二：读论文遇到不懂的地方

选中 PDF 里的一段话：

> "这段话里的 KL divergence 是什么意思？为什么要用它做正则化？"

### 场景三：写 Related Work

选中几篇论文：

> "帮我总结这几篇论文的核心方法，用中文写一段 related work"

---

## 常见问题

**Q: 支持 Zotero 6 吗？**

A: 目前只支持 Zotero 7。

**Q: 可以用 Claude/GPT-4 吗？**

A: 可以，任何兼容 OpenAI API 格式的服务都能用。

**Q: 论文太长怎么办？**

A: 建议选中具体段落提问，或使用支持长上下文的模型。

---

## 后续计划

- [ ] 文献管理功能（查询、归档、整理）
- [ ] 更多论文源（Google Scholar、Semantic Scholar）
- [ ] 批量操作优化

**更多需求？欢迎提 [Issues](GitHub Issues 链接)！**

---

## 链接

- GitHub：[项目地址]
- 下载：[Release 页面]
- 问题反馈：[Issues]

---

*如果觉得有用，欢迎 Star ⭐️*
