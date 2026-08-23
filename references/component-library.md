# EVSE 器件目录的分层边界

平台有三类不同数据，不能混为一个“component library”。

## 1. 领域角色清单

`engine/component-library.js` 保存从参考资料整理的设备角色、必备项和来源证据。它用于工程检查与说明，不是端子级料号库，也不允许仅凭其中的名称自动接线。

## 2. 受控 DeviceClass 目录

`engine/device-catalog.js` 是 EDEM v4 当前使用的工程类别目录，定义：

- 设备类别及生命周期状态；
- 功能口到物理端子的映射基础；
- `netClass`、`domain`、方向、相别、极性、电压和协议；
- 充电连接器针脚由 `engine/connector-library.js` 提供。

只有 `APPROVED` 定义可以实例化。当前内置目录是经代码评审和回归测试的类别模板，不代表任何厂家 SKU 已被批准。

## 3. 厂家 PartVariant 工作台

`component-workbench/` 接收 TXT、JSON 或受控 PDF 外部抽取文本，生成带字段级证据的声明式候选。流程固定为：

```text
EXTRACTED_DRAFT -> REVIEWED -> APPROVED -> DEPRECATED
```

每个候选可包含多个连接器、多个功能单元、功能口和物理端子。源 SHA-256、文档版本、页码、bbox、原文引文与置信度缺一不可；`UNKNOWN`、低置信度、伪造引文、悬空引用或单向映射都会阻断批准。修订采用只追加哈希链，只有最新 `APPROVED` 记录能导出受控 JSON。

## 安全规则

- PDF/手册是不可信输入，内容永不执行；
- AI 只能生成草稿，不可批准自己生成的数据；
- 端子不能靠编辑距离、别名猜测或“常见接法”自动等同；
- PE、FE、机壳地、信号地、辅助 0V 与 DC− 必须保持独立语义；
- router 只接收已经通过 ERC 的网表，不补连接；
- 厂家目录不能替代型式试验、技术协议、RFQ 或专业审查。

工作台命令、Schema 与示例见 `component-workbench/README.md`。
