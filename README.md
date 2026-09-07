# AssetCollector

本地流程 skill 仓库和格式说明。回答“有没有现成做法、流程怎么写、检查项是否写清”。执行者始终是调用它的 agent。

0.1 已实现：登记、列表、全文查找、读取、格式检查、模板输出、agent context。没有服务、数据库、执行器或网络调用。不预置业务流程。

## 安装

需要 Node.js 22+。

```sh
npm ci
npm test
npm link
assetcollector context
```

## 使用

```sh
assetcollector list --json
assetcollector search "任务关键词" --json
assetcollector show skill-name --json
assetcollector template skill-name --description "何时使用及解决什么问题" > /tmp/SKILL.md
# 在一个同名目录里完成 SKILL.md，按需要加入 references/、scripts/ 等资源
assetcollector add /path/to/skill-name --json
assetcollector check skill-name --json
```

`add` 将整个目录导入 `skills/<name>/`，保留相对资源路径。导入后这份目录是仓库里的正式版本；用 `show` 找到它，直接修改文件即可更新。重复登记同名流程报错，不自动覆盖。不自动同步原目录，不扫描外部项目。导入只接受普通目录和文件，不跟随符号链接。

目录是唯一真相。也可以直接在 `skills/` 下创建、编辑、移动出或删除完整 skill 目录，下一次查询立即生效。没有需要同步的索引。一个流程的目录名必须与 frontmatter `name` 一致。

目录位置依次取 `--skills-dir`、`ASSETCOLLECTOR_SKILLS_DIR`、本项目的 `skills/`。读空仓库返回空列表，不会生成文件。测试使用临时目录。

## 边界

- 不自动执行 skill、脚本、网络请求，也不验证任务实际上有没有做好。
- 不自动发现值得固化的流程、不判断流程粒度。
- 不存采集结果、信息源档案或需求登记；这些属于 AssetHub。
- API、凭据和工具说明从 AgentPulse 查询。
- `check` 是显式文档检查：缺少检查清单或有未完成模板时报告 findings 并返回非零。`add` 只对不可解析的元数据、非法名称和目录冲突拒绝登记；文档 findings 会随结果返回，不充当执行闸门。

所有命令支持 `--json`，返回 `{schemaVersion, command, generatedAt, data, errors}`。失败退出 1；空查询退出 0；`check` 有 findings 时退出 1 且仍返回完整报告。

格式约定见 [SKILL-FORMAT.md](docs/SKILL-FORMAT.md)。跨项目接入见 [InfoStack](../InfoStack/USAGE.md)。
