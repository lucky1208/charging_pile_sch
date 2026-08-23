# 数据模型与审核流程

## 1. 为什么分四层

`DeviceClass` 是领域角色，例如直流接触器；`FunctionalPort` 是拓扑编译器使用的语义端口，例如 `DC_IN_POS`；`PhysicalTerminal` 是手册上的真实接线点，例如 `X1/1`；`PartVariant` 是具体厂家型号及其端口映射。

`PartVariant.connectors[]` 可以表达功率端子排、线圈插座、辅助触点插座等多个连接器；`functionalUnits[]` 可以分别表达主触点、线圈、辅助触点等多个功能单元。拓扑编译器以后只允许消费已批准的功能端口到真实端子的映射。

功能端口引用物理端子时使用 `connectorId/terminalId`，例如 `X2/A1`。物理端子同时必须反向引用功能端口 ID。任一方向缺失都会验证失败。

## 2. 声明与证据

所有业务字段采用声明对象：

```json
{
  "value": "A1",
  "confidence": 0.98,
  "evidence": [
    {
      "page": 6,
      "bbox": { "x": 122, "y": 318, "width": 41, "height": 13, "unit": "PDF_PT" },
      "quote": "A1 24V+"
    }
  ]
}
```

候选 JSON 不能自己声明可信的源哈希。`extract` 读取源文件字节后计算 SHA-256，并把下列字段注入每一条证据：

```json
{
  "sourceSha256": "…64位十六进制…",
  "documentVersion": "REV-C",
  "sourceFile": "manual.pdf",
  "quoteSha256": "…64位十六进制…"
}
```

程序会把 NFC/空白规范化后的 `quote` 与其声明页的提取文本逐项核对；页不存在或该页原文不存在时分别以 `EVIDENCE_PAGE_NOT_FOUND`、`EVIDENCE_QUOTE_NOT_FOUND` 阻断。PDF 交接文本使用 `\f` 分页。`bbox.unit` 可为 `PDF_PT`、`NORMALIZED`、`PIXELS` 或 `TEXT_LINES`；纯文本无法独立证明视觉 bbox，因此批准人仍须对照原 PDF 核实坐标。

JSON 厂家资料可以作为证据原文，但必须与候选 JSON 分离。同一文件、硬链接或逐字节相同副本都被视为循环自证并阻断。

## 3. 生命周期

```text
EXTRACTED_DRAFT --review--> REVIEWED --approve--> APPROVED --deprecate--> DEPRECATED
```

不允许跳级、回退或从 `DEPRECATED` 恢复。审核动作只改变修订元数据，不允许改变源资料或模型。如果候选需要修正，应以新的、可追溯 `recordId` 重新导入。

每个生命周期动作采用 action 所对应的角色，且 actor 经 NFKC、空白折叠和大小写规范化后必须与此前所有动作 actor 不同。这在本地数据层阻断自审自批；真实姓名/账号别名仍应由宿主身份系统和组织权限控制。

批准检查比普通格式验证更严格：

- 任一实体或字段 `confidence < 0.8` 阻断；
- 任一声明的值为 `UNKNOWN` 阻断；
- 缺证据、证据字段不完整或证据源哈希/版本不一致阻断；
- DeviceClass 引用错误、重复 ID、悬空引用或非双向端子映射阻断；
- FunctionalUnit 引用不存在的连接器或功能端口阻断。

`UNKNOWN` 可以进入草稿和审核态，目的是显式暴露手册缺口；它永远不能获批或被自动接线消费。

## 4. 不可变历史

存储布局：

```text
<store>/records/<recordId>/revisions/
  000001.json
  000001.sha256
  000002.json
  000002.sha256
  ...
```

写文件使用 exclusive create，已有文件绝不覆盖。每一版记录 `previousRevisionSha256`，指向上一版 JSON 文件的精确 SHA-256。`verify` 从创世修订起重新验证：

- 文件与 sidecar 哈希一致；
- 修订号连续；
- 前一版哈希链接正确；
- 状态转换合法；
- 生命周期转换时 payload/source 完全不变；
- 时间不倒退。
- 每个动作 actor 与此前动作保持分离。

这是本地防误改和篡改可见机制，不替代组织级签名、WORM 存储、备份或访问控制。

## 5. 安全边界

- 只接受 `.txt`、`.json`、`.pdf`；`.js` 等类型在读取前按类型拒绝。
- JSON 只用 `JSON.parse`，拒绝 `__proto__`、`constructor`、`prototype` 键、过深对象和超大输入。
- JSON 使用 fatal UTF-8 解码并在解析前拒绝重复键，避免“不同工具显示不同值”的审计歧义。
- `recordId` 采用受限 ASCII 语法并拒绝 Windows 设备名；受控 store 的所有路径拒绝符号链接/目录联接。
- 文件用同一 descriptor 完成检查与读取，并对比打开前后的设备号、inode、大小和时间，换包时 fail-closed。
- 没有 `eval`、`Function`、动态 `require`、网络调用或从手册内容构造 shell 命令。
- CLI 不加载外部 extractor 模块；PDF 只接受调用方生成的纯文本文件。
- 受控目录导出使用 exclusive create，避免无意覆盖审计产物。
- 导出只读取每个 record 的最新修订；最新态不是 `APPROVED`、历史不完整或目录含非规范修订文件时拒绝导出。

## 6. 与绘图平台的集成边界

当前 P3 工作台独立于 `engine/component-library.js`。在 P1/P2 端子级模型稳定后，集成层只能读取 `evse.controlled-component-catalog/v1` 且必须再次检查：最新状态 `APPROVED`、`autoWiringAllowed=true`、记录哈希及 catalogVersion。不要让草稿记录直接进入拓扑编译或绘图代码。
