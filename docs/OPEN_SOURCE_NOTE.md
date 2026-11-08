# 开源版说明（2026-11-08）

本文件记录**从内部发布包到开源版**所做的改动，便于使用者、贡献者与企业评审理解版本差异。

## 1. 许可与权利

- 项目由作者**独立搭建、独立维护**（含 BUG 修复与版本迭代），作者决定将其开源到个人 GitHub 账号。
- 原发布包 `LICENSE` 为内部使用声明（含企业版权署名与「不得向公司以外提供源代码」），**已作废并整体替换**为 `MIT License`，署名 `Smart Filter —Bink`。
- 版权人已在 `LICENSE` 第 3 行署名为 `Smart Filter —Bink`；如需变更，直接修改该行即可。第三方组件仍按各自许可证使用，见 `THIRD_PARTY_NOTICES.md`。

> 建议：尽管作者已确认有权开源，仍建议留存一份书面授权/确认记录（内部邮件即可），以便日后向企业客户或平台说明权属。

## 2. 内置数据已全部示例化

原先 `data/preset-backup.json` 是从实际使用环境导出的设置备份，包含真实公司名、26 个真实在招岗位（含薪资、年龄条件、JD 原文）、招聘话术与导出时间。现已**整体重写为虚构示例数据**：

| 项 | 开源版取值 |
|---|---|
| 公司名 | `示例科技（Example Tech）` |
| 默认岗位 | `示例·嵌入式软件工程师` |
| 26 个岗位 | 通用示例岗位，标题统一 `示例·` 前缀；JD 标注「虚构数据，非真实招聘信息」 |
| 薪资 / 城市 | 演示用数值 / `北京|上海` |
| 年龄、第一学历硬门槛 | 不预置（`ageMax: null`、`ageFilled: false`） |
| AI 端点 / 密钥 / 远程配置地址 | 全部为空，默认关闭 |
| 话术 | 改为带 `{company}` / `{position}` 占位符的示例话术 |
| 导出时间 | `2026-01-01T00:00:00.000Z`（占位） |

同时修正了代码中的**硬编码默认值**（`services/store.js` 的 `company`、`position`、`baseDefaults.cities` 与迁移逻辑），以及 `services/jd-sheet.js`、`options/options.html` 中的默认城市提示。

替换方法见 `data/README.md`。

## 3. 文档与注释清理

- `CHANGELOG.md` 保留完整版本演进，但移除公司名称、内部系统名、真实导出文件名，并在文件头加注「历史说明」声明。
- `README.md` 重写为开源版首屏；新增 `README.en.md`。
- UI 文案、安装说明、RPA 脚本注释中的内部指向性表述（内部联系人、内部服务器地址示例、截图求助等）改为「GitHub Issue（先脱敏）/ 自建配置服务器 / 编辑器终端」。
- 原「配套工作台」相关标识统一改为中性名：`WB_NAME` 匹配 `示例工作台`，消息类型 `EXAMPLE_REC_STATUS` / `EXAMPLE_OPEN_PANEL` / `EXAMPLE_REC_AUTORUN*`，启动项名 `smartfilter-rpa`。
  - **注意**：这些是可扩展集成点的标识。若需与企业内部工作台联动，请同步修改 `services/scheduler.js` 中的常量与对方扩展的消息名。
- 新增 `docs/AUTOMATION.md` 说明平台条款与自动化能力的边界。

## 4. 明确保留的部分

按作者决定，以下能力**原样保留、未做删减**：

- `manifest.json` 全部权限声明（`debugger`、`management`、`optional_host_permissions` 等）；
- 内容脚本在招聘站点的注入与 MAIN world 钩子；
- `rpa-helper/` 本机自动化助手（含开机自启与本地回环端口）；
- 计划任务、自动打招呼 / 智选、职位抓取等全部既有功能；
- `lib/` 下全部第三方库文件及其校验码（**未改动任何文件**，`VENDOR.json` 9 组件 28 个 SHA256 仍全部匹配）。

使用者与企业部署方需自行评估这些能力是否符合第三方平台条款与本单位安全策略，见 `docs/AUTOMATION.md`、`docs/PRIVACY.md`、`docs/PERMISSION_JUSTIFICATION.md`。

## 5. 新增的开源物料

`LICENSE`、`README.md`、`README.en.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`.gitignore`、`data/README.md`、`docs/`（PRIVACY / MODEL_CARD / AUTOMATION / ENTERPRISE / PERMISSION_JUSTIFICATION / OPEN_SOURCE_NOTE）、`.github/`（CI、Issue 模板、PR 模板、Dependabot）。

## 6. 版本号

`manifest.json` 仍为 `3.6.0`，功能行为未变更；本开源版仅做数据示例化、文档与许可证调整。建议以 `v3.6.0` 作为首个 Release tag。
