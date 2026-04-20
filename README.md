# Zotero Agent

Zotero 7 的 AI 助手插件，帮你阅读、总结、理解论文。

## 特点

- **纯对话交互** - 像聊天一样使用，无需学习复杂操作
- **斜杠命令配置** - 在对话框中输入 `/` 命令即可完成配置，无需打开设置界面
- **支持多种 AI** - 豆包、DeepSeek、OpenAI 等，任选其一
- **浮动面板** - 可拖拽、可调整大小，不影响正常使用 Zotero
- **论文下载** - 支持从 arXiv 搜索和下载论文（更多来源开发中：PubMed、Semantic Scholar...）

## 安装

1. 从 [Releases](../../releases) 下载 `zotero-agent.xpi`
2. 打开 Zotero → 菜单 `Tools` → `Plugins`
3. 点击右上角 ⚙️ → `Install Plugin From File...` → 选择下载的文件
4. 重启 Zotero

## 使用示例

点击右下角的 🦆 图标打开对话框。

### 配置 AI（首次使用）

直接在对话框输入命令，按回车执行：

```
/apibase https://ark.cn-beijing.volces.com/api/v3
/apikey 12a92e6f-8bbc-44b4-81c7-xxxxxxxxxxxx
/model doubao-seed-2-0-pro-260215
```

输入 `/config` 确认配置是否成功。

### 论文问答

选中一篇论文，直接问：

```
你好
> 你好！我是Zotero学术研究助手...

总结这篇论文
> 这篇论文主要研究了...

这篇论文用了什么方法？
> 论文采用了以下方法：1. ...
```

### 选中文本总结

在 PDF 阅读器中选中一段文字，然后问：

```
总结选中的段落
> 这段内容主要讲述了...
```

### 从 arXiv 搜索下载论文

```
去 arXiv 搜索 attention mechanism 相关论文
> 找到以下论文：1. Attention Is All You Need ...

下载 1
> 正在下载并导入到 Zotero...
```

## 命令列表

输入 `/` 会弹出命令菜单，用方向键选择，回车确认。

| 命令 | 说明 |
|------|------|
| `/apibase <地址>` | 设置 API 地址 |
| `/apikey <密钥>` | 设置 API 密钥 |
| `/model <模型名>` | 设置模型 |
| `/config` | 查看当前配置 |
| `/reset` | 重置所有配置 |
| `/clear` | 清空对话历史 |
| `/help` | 显示帮助 |

## 开源协议

AGPL-3.0-or-later
