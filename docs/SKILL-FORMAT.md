# 流程 skill 格式

每个流程一个目录，入口是 `SKILL.md`。其他文件仅在流程实际需要时添加。

```text
skill-name/
  SKILL.md
  references/    可选：按需阅读的资料
  scripts/       可选：由执行 agent 决定运行的辅助脚本
  assets/        可选：输出所需模板或静态文件
```

## 元数据

文件开头必须是 YAML frontmatter：

```yaml
---
name: skill-name
description: 描述什么任务会用到此流程及其作用
---
```

`name` 与目录名一致，1–63 个小写字母、数字及单连字符；`description` 是非空文本，支持 YAML 多行标量。可保留 `metadata` 等额外元数据。

## 正文

只固定一项格式要求：存在“检查”环节，提前列出需要检查的事项。支持 `检查`、`验证`、`检查清单`、`Checks`、`Validation`、`Verification`、`Checklist` 标题及其下的列表。代码块里的示例标题不算检查环节。

输入、步骤、输出可以按任务需要组织，不规定粒度、步数、来源数量或固定工具。`template` 提供这几个段落方便起草，模板里的 TODO 需要替换，不能当成已经完成的流程。

检查项可以是主观判断；执行 agent 在交付时说明哪些已检查、哪些失败、哪些未能验证。文档检查通过只代表检查项写了出来，不代表任务质量合格。

## 与其他模块衔接

流程需要外部能力时，查询 AgentPulse 并由 agent 直接调用。需要保留数据时，使用 AssetHub 的 schema 和命名空间；格式扩展由使用方通过 AssetHub 注册，不能靠流程私自另建持久数据目录。

资源链接相对当前 skill 目录。AssetCollector 返回正式文件位置供 agent 阅读，绝不自动执行 `scripts/`。已有会话授权和用户的具体任务约束继续适用，登记流程本身不会授权发布或其他外部动作。
