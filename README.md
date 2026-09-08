# AssetCollector

本地流程 skill 仓库和格式说明。回答“有没有现成做法、流程怎么写、检查项是否写清”。执行者始终是调用它的 agent。

0.1 已实现：按命名空间登记、列表、全文查找、读取、格式检查、模板输出、`status`、agent context 和按需启动的只读 Web。没有数据库、执行器或外部网络调用。不预置业务流程；使用方流程放在用户数据目录。

## 安装

需要 Node.js 22+。

```sh
npm ci
npm test
npm link
assetcollector status
```

## 使用

```sh
assetcollector status --json
assetcollector namespace add tukahu
assetcollector list --json
assetcollector search "任务关键词" --json
assetcollector show tukahu/editorial-article --json
assetcollector template editorial-article --description "何时使用及解决什么问题" > /tmp/SKILL.md
# 在一个同名目录里完成 SKILL.md，按需要加入 references/、scripts/ 等资源
assetcollector add /path/to/editorial-article --namespace tukahu --json
assetcollector check tukahu/editorial-article --json
```

`add --namespace` 将整个目录导入 `<catalog>/<namespace>/<name>/`。导入后这份目录是用户数据目录里的正式版本；用 `show` 找到它，直接修改即可更新。重复登记同名流程报错，不自动覆盖。导入只接受普通目录和文件，不跟随符号链接。

布局：`<catalog>/<namespace>/<skill>/SKILL.md`。通用流程用 `shared`，项目流程与 AssetHub 使用同一命名空间 id。frontmatter `name` 必须与 skill 目录名一致。`demand.workflow` 存限定名，例如 `tukahu/blog-publish`。

目录位置依次取 `--skills-dir`、`ASSETCOLLECTOR_SKILLS_DIR`、`$XDG_DATA_HOME/assetcollector`、`~/.local/share/assetcollector`。读空目录返回空列表，不会生成文件。本仓库的 `skills/` 不是默认目录。测试使用临时目录。

## 边界

- 不自动执行 skill、脚本、网络请求，也不验证任务实际上有没有做好。
- 不自动发现值得固化的流程、不判断流程粒度。
- 不存采集结果、信息源档案或需求登记；这些属于 AssetHub。
- API、凭据和工具说明从 AgentPulse 查询。
- `check` 是显式文档检查：缺少检查清单或有未完成模板时报告 findings 并返回非零。`add` 只对不可解析的元数据、非法名称和目录冲突拒绝登记；文档 findings 会随结果返回，不充当执行闸门。

除 `web` 外，所有命令支持 `--json`，返回 `{schemaVersion, command, generatedAt, data, errors}`。失败退出 1；空查询退出 0；`check` 有 findings 时退出 1 且仍返回完整报告。

## 只读 Web

```sh
assetcollector web
# 自定义端口或目录
assetcollector web --port 4125 --skills-dir /path/to/catalog
```

打开 http://127.0.0.1:4125 。页面按命名空间列出流程，详情路径为 `/n/<namespace>/<skill>`。直接读取现有目录，修改文件后刷新即可。空目录不会自动创建。Web 不提供登记、编辑、删除或执行功能，也不提供资源文件下载。

仅监听本机 `127.0.0.1`，按 Ctrl+C 停止。默认端口与 AgentPulse（4123）、AssetHub（4124）错开，无需额外依赖或构建步骤。

格式约定见 [SKILL-FORMAT.md](docs/SKILL-FORMAT.md)。跨项目接入见 [InfoStack](../InfoStack/USAGE.md)。
