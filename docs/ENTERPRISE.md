# 企业部署指南

## 1. 部署形态

| 形态 | 适用 | 数据流向 | 运维成本 |
|---|---|---|---|
| GitHub Release zip + 加载已解压 | 试点 / 小团队 | 全本地 | 最低 |
| **组策略强制分发** | 受管设备批量部署 | 全本地 | 低（一次配置） |
| 内网离线分发 | 无外网 / 高保密环境 | 全本地 | 中（需 IT 下发） |
| Chrome 网上应用店 | 公开分发 | 全本地 | 低，但需通过审核 |

> 高权限与自动化能力的企业评估事项见 `AUTOMATION.md`；建议试点阶段先关闭 RPA 与 AI，仅使用本地解析、可解释评分与决策审计。

## 2. Chrome Enterprise / 组策略

管理员在 Google Admin Console 或 Windows GPO 中配置：

- `ExtensionInstallForcelist`：按 `<扩展ID>;https://clients2.google.com/service/update2/crx` 强制安装；
- `ExtensionSettings`：锁定版本、控制站点访问权限、禁止用户卸载或禁用；
- 配合 `ExtensionInstallBlocklist: ["*"]` 白名单策略，实现只允许已审批扩展。

扩展 ID 在首次打包/上架后确定；离线分发如需固定 ID，可在 `manifest.json` 设置 `key` 字段（**需要保密的是打包私钥 `.pem`，不是 `key` 本身**）。

## 3. 内网离线部署

1. 从 GitHub Release 下载对应版本 zip 并校验 `SHA256SUMS.txt`；
2. 由 IT 通过内网软件分发渠道下发到指定目录；
3. 在受管浏览器策略中允许加载该解压目录；
4. 关闭「可选 AI 判断」与「可选 RPA 助手」，保证纯离线运行；
5. 每季度同步一次新版本，保留旧版本回滚包。

## 4. 审计与可追溯

- 每次判定输出维度得分、命中/缺失证据、规则版本与决定记录 ID；
- 决定明细可导出 CSV / JSON，建议与人工复核结论一起归档；
- 决定明细保留 90 天、月度汇总（仅数字）保留 3 年，可在「设置 · 合规」调整；
- 全量加密备份（`.sfbak`）支持换机恢复与按期限自动清理；
- 版本与权重变更记录在 `CHANGELOG.md`，权重默认值变更提升次版本号。

## 5. 安全评审预置材料

| 材料 | 路径 |
|---|---|
| 开源许可证 | `LICENSE` |
| 第三方组件与许可证清单 | `THIRD_PARTY_NOTICES.md` |
| 第三方库版本与 SHA256 | `lib/VENDOR.json` |
| 数据流、权限与保留期说明 | `docs/PRIVACY.md` |
| 判定维度、不使用特征与局限 | `docs/MODEL_CARD.md` |
| 逐权限理由 | `docs/PERMISSION_JUSTIFICATION.md` |
| 自动化能力与风险 | `docs/AUTOMATION.md` |
| 漏洞披露渠道 | `SECURITY.md` |
| 示例数据说明 | `data/README.md` |

## 6. 支持边界

开源版按 MIT 提供，社区通过 Issue / Discussions 支持。SLA、私有规则库、与内部 ATS 集成等可作为独立商业服务，**不得在 README 中暗示开源版缺少已承诺的能力**。
