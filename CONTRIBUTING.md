# 贡献指南

感谢你愿意让 Smart Filter 变得更好。项目由作者独立开发与维护，欢迎任何形式的参与。

## 参与方式（不写代码也欢迎）

- 提交 [Bug 报告](https://github.com/Bink-citl/-smart-filter-extension/issues/new/choose) 或功能建议
- **补充岗位规则模板 / 示例数据**：`data/` 与筛选规则最容易上手，HR 同学也能参与
- 改进文档、翻译、示例数据、隐私政策措辞
- 在 [Discussions](https://github.com/Bink-citl/-smart-filter-extension/discussions) 分享你的筛选场景与权重经验

## 本地开发

本扩展**不需要构建**，使用原生 JS / HTML / CSS：

```bash
git clone <你的仓库地址>
cd smartfilter
```

1. 打开 `chrome://extensions`，开启「开发者模式」；
2. 点「加载已解压的扩展程序」，选择含 `manifest.json` 的仓库目录；
3. 改动后回到扩展页点「重新加载」，再刷新已打开的招聘页面；
4. 打开工作台，「导入内置岗位」可载入 `data/preset-backup.json` 的 26 个虚构示例岗位。

可选的本机 RPA 助手在 `rpa-helper/`，安装与卸载见 [INSTALL.txt](./INSTALL.txt)。

## 提交 PR 前

- [ ] 从 `main` 新建分支，命名如 `feat/rule-template`、`fix/pdf-empty-text`
- [ ] 提交信息使用 `feat:` / `fix:` / `docs:` / `test:` / `chore:` 前缀
- [ ] 在浏览器里实际加载并验证改动（至少覆盖受影响的页面）
- [ ] **未提交任何真实简历、真实岗位、客户数据、薪资数据或密钥**
- [ ] 新增示例数据为虚构数据，并带 `示例·` 或 `FICTIONAL` 标记
- [ ] 涉及权限或网络请求变更时，同步更新 `manifest.json` 说明、README 与 `docs/PRIVACY.md`
- [ ] 涉及判定逻辑变更时，同步更新 `docs/MODEL_CARD.md` 与 `CHANGELOG.md`
- [ ] 新增第三方库放入 `lib/`，并在 `lib/VENDOR.json` 登记版本、来源与 SHA256，同时更新 `THIRD_PARTY_NOTICES.md`

## 代码约定

- 保持 Manifest V3 约束：不加载远程代码、不用 `eval` / `new Function`、不申请无关权限。
- 第三方库必须随包本地化。
- 判定逻辑必须可解释：新增维度需在模型卡写明依据与局限。
- 默认不引入任何数据上传路径；可选外部能力默认关闭且显式告知用户。
- 不引入受保护属性（性别、年龄、婚育、民族、宗教、籍贯等）作为默认筛选条件。

## CI

`.github/workflows/manifest-check.yml` 不依赖 npm，会检查：Manifest V3 结构、版本号与 tag 一致、必填文件、示例数据标记、公司信息残留、远程脚本 / 密钥 / 手机号、以及 `lib/VENDOR.json` 全部文件的 SHA256。请在提交前自行确认不引入敏感信息。

## Issue 响应

维护者目标：尽快首次响应；标有 `good first issue` 的条目会附带复现步骤、涉及文件与验收标准。

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 许可

贡献的代码默认以仓库 [MIT](./LICENSE) 许可证授权给所有使用者。
