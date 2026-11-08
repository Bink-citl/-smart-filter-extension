# 安全政策

## 支持的版本

| 版本 | 安全更新 |
|---|---|
| 3.6.x（最新） | ✅ |
| 更早版本 | ❌ 请升级 |

## 报告漏洞

**请勿在公开 Issue 中报告安全漏洞。**

请通过仓库的 **[Security → Report a vulnerability](https://github.com/Bink-citl/-smart-filter-extension/security/advisories/new)** 提交私密报告（GitHub Private Vulnerability Reporting）。若该功能未开启，请通过维护者在 GitHub 个人资料页公开的联系方式私下联系。

报告请包含：

- 影响版本与浏览器版本
- 复现步骤与最小示例（**先脱敏，不要附带真实简历或候选人数据**）
- 影响范围，尤其是是否可能导致本地数据泄露或权限被滥用
- 可能的修复建议、以及是否同意在修复后公开致谢

## 响应承诺

- 尽快确认收到
- 初步评估后给出处理结论
- 修复完成后发布补丁版本，并在 Release Notes 中说明

## 本项目的安全边界

- 默认不收集、不上传任何简历数据；所有处理在浏览器本地完成。
- 可选 AI 判断默认关闭，启用后由用户自行配置端点与密钥。
- 可选本机 RPA 助手由用户手动安装，仅监听 `127.0.0.1`，校验自定义请求头与扩展来源；可随时停止并取消开机自启。
- 扩展遵循 Manifest V3，不加载远程代码；第三方库全部随包分发并在 `lib/VENDOR.json` 记录 SHA256。
- 报告前请确认问题不是由用户自行配置的第三方 API 端点或自装 RPA 助手引起。

## 已知需要使用者自行评估的点

扩展声明了 `debugger`、`management`、`host_permissions`（招聘站点）、`optional_host_permissions`（全站通配）与 `http://127.0.0.1/*`，并提供自动化执行能力。这些是产品既定设计，企业部署前应由 IT / 安全部门评估。逐项用途见 [docs/PERMISSION_JUSTIFICATION.md](./docs/PERMISSION_JUSTIFICATION.md)。

## 依赖安全

`lib/VENDOR.json` 提供每个第三方库文件的 SHA256，CI 会逐项校验。若发现依赖漏洞，也请按上述渠道报告。
