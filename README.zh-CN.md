# dsh-model-modality

为 DSH 模型设置页提供逐模型的输入类型与思考等级配置。

[English](README.md)

## 功能

| 设置项 | 界面位置 | 配置字段 |
| --- | --- | --- |
| 文本 / 图片输入 | **设置 → 模型**中的提供方卡片 | `input` |
| 思考等级 | 提供方**编辑**对话框内，展开模型行后，位于上下文窗口及最大输出 token 附近 | `reasoningEfforts` |

插件仅作用于 `@deepseek-ai/dsh-llm-pi-ai` 管理的提供方。配置按提供方、按模型独立保存。一级卡片仅显示输入类型，思考等级保留在二级编辑对话框。

这些配置用于声明模型能力，不会为提供方增加不支持的功能，也不用于生成图片或选择单次请求的思考等级。

## 兼容性

已针对以下版本验证 UI 补丁：

| DSH | 模型编辑器布局 |
| --- | --- |
| `0.1.5-rc.1`，模型 UI 为 `0.1.5-rc.2` | 旧版模型编辑器 |
| `0.2.0-rc.2` | 共享 `ModelRow` 编辑器 |

不承诺未经验证的后续版本兼容。思考等级控件依赖 `@deepseek-ai/dsh-client-ui-settings-models` 的界面结构；不支持的布局会记录错误，且不会写入补丁。

使用条件：

- 目标 DSH profile 已启用 Web 模型设置界面。
- 使用 pi-ai 适配器管理的提供方；其他适配器不受影响。
- 如需思考等级控件，必须能够写入已安装的模型 UI bundle。

## 安装

```sh
dsh plugin --profile web add github:hmtxj/dsh-model-modality
```

安装后重启目标 profile，再打开**设置 → 模型**。包内已声明 Cordis bundle，无需手动修改 profile 清单。

从本地开发目录安装：

```sh
git clone https://github.com/hmtxj/dsh-model-modality.git
dsh plugin --profile web add link:/absolute/path/to/dsh-model-modality
```

无需构建，也无需运行 `prepare` 脚本。

## 使用

### 输入类型

已配置的提供方卡片会列出该提供方实际提供的模型。

- **文本**始终开启，该控件不允许取消。
- 勾选**图片**：写入 `input: [text, image]`。
- 取消**图片**：写入 `input: [text]`。

输入类型修改立即保存。取消图片输入会明确声明仅支持文本，而不是恢复模型目录默认值。

### 思考等级

打开提供方的**编辑**对话框，展开模型行，可声明 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 七种档位。

仅选择提供方实际支持的档位，然后按对话框原有的保存方式保存。

- 所选档位替换当前声明，采用同名映射，例如 `{ "high": "high", "max": "max" }`；`off` 对应 `null`。
- 全部取消：删除显式声明，继承模型目录配置。
- 仅勾选 `off`：不予接受，因为适配器不支持该声明。

输入类型修改写入现有 `models` 条目；使用模型目录时，写入 `modelOverrides`。思考等级则沿用原生编辑器的保存流程，可能创建或更新显式 `models` 列表。保存前请检查提供方的模型列表。

## UI 补丁与限制

输入类型控件使用模型设置页的官方扩展槽位。受支持的编辑对话框没有相应槽位，因此插件会在 profile 加载时，对已安装的模型 UI bundle 应用定点补丁。

- 写入前，在原文件旁保存 `client.js.pre-thinking-patch` 备份。
- 重复加载不会重复应用相同补丁。
- 锚点缺失或写入失败会记录日志；不支持的布局不会被修改。
- DSH 更新替换 bundle 后，插件会在下次 profile 加载时尝试重新应用补丁，但仍需满足布局兼容条件。

移除插件不会自动恢复已经修改的 bundle。禁用插件后，只能使用与当前 bundle 版本对应的原始备份恢复。

当前版本的输入类型接口要求 loopback `Host`。反向代理若转发外部域名，可能收到 `403`；远程代理兼容性不属于已验证范围。

## 开发

```sh
npm test
```

测试覆盖宿主接口、两种 UI 补丁布局和浏览器扩展。无需安装 DSH；可选的真实 bundle 检查仅操作临时副本。

架构、接口及手动补丁诊断见 [开发文档](https://github.com/hmtxj/dsh-model-modality/blob/main/docs/DEVELOPMENT.md)。问题反馈请提交至 [GitHub Issues](https://github.com/hmtxj/dsh-model-modality/issues)，并提供可复现步骤。

## 许可证

[MIT](LICENSE)
