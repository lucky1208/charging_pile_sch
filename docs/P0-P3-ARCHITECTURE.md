# P0–P3 架构与安全边界

## 1. 为什么不再让渲染器重画拓扑

旧版本同时维护“功能块连接图”和“手写 SVG 坐标拓扑”。两份事实无法由程序证明一致，导致 DC 极性反接、四枪交叉阻断、Web/CLI 分叉等问题。2.0 的规则是：

```text
一个需求契约
  -> 一个端子级电气模型
  -> 一个几何中间表示
  -> 多个只读渲染器
```

渲染器没有新增、删除、合并或猜测连接的权限。

## 2. P0：RequirementSpec 与单一运行时

`engine/requirement-spec.js` 保存规范化需求及其来源、原文、置信度、问题、未决项和确认状态。自动翻译缺置信度、低于阈值或仍有未决项时，生成分成“翻译”和“用户确认”两步。

当前 capability gate 仅开放：

- `standard ∈ {gb, eu, us}`；
- `archetype = dc-integrated`。

能被词法识别不代表已有工程实现。NACS、CHAdeMO、分体式、交直流一体和移动储能桩不会回退为相似标准，而是阻断并说明原因。

`engine/` 是浏览器与 CLI 的唯一核心源码。`scripts/sync-web.js` 自动复制模块并按受控依赖顺序生成 bundle；测试逐字节验证同步结果。

## 3. P1：EDEM v4、受控目录与 ERC

### 两层端口模型

- `functionalPorts`：表达设备在系统中的功能，例如 AC 输入、直流输出、通信接口；
- `physicalTerminals` / `terminals`：表达可接线的真实端子；功能口显式列出所映射的物理端子。

项目模型包含：

- `instances`：受控 `DeviceClass` 的项目实例；
- `nets`：具有 `netClass/domain/phase/polarity/voltage/protocol` 的电气节点或超边；
- `circuits`：为绘图与追溯拆出的精确 `instance:terminal -> instance:terminal` 边，每条都引用一个 `netId`。

交流相线、直流双极、PE 和不同辅助电压域不再压缩成聚合端口。枪连接器直接使用库中的 CC1/CC2/S± 或 CP/PP 物理针脚。储能保护拆成熔断、主正/主负接触器、预充接触器与预充电阻，变换器并网侧也有明确保护实例。

ERC 至少阻断：

- 未批准器件定义、重复或缺失实例/端子/网络/回路 ID；
- 不存在的精确端点、必接端子开路、同一端子落入多个网络；
- 网络类别、电气域、相别、极性、电压范围或协议冲突；
- 网络没有源/负载、回路端点不属于所声明网络、网络回路不连通；
- 连接器 DC+/DC− 短接、反接或 PE 错接。

## 4. P2：Drawing IR 与确定性布线

`engine/schematic-placement.js` 只读 EDEM。设备按稳定规则放置，端子锚点进入 keepout 感知的通道路由；区间图着色为重叠区间分配最少 lane，容量不足立即失败。

全部线路完成后，`Drawing IR` 一次性分类：

- 同网连接点 `junction`；
- 不同网视觉交叉 `bridge`；
- 不同网接触、共线重叠、自交和穿 keepout 为阻断违规。

`auditCoverage()` 验证每台设备、每个网络和每条回路的 exact endpoints 与路由一一对应。SVG 和 DXF 只消费通过校验的 IR，并分别以 `data-*` 与 DXF XDATA 保留设备、端子、网络、回路和路由 ID。

## 5. P3：AI 辅助器件资料导入

P3 不是让 LLM 自动写生产器件库。它是隔离的 library workbench：

```text
资料字节/PDF外部纯文本
  -> EXTRACTED_DRAFT JSON
  -> 工程审核 REVIEWED
  -> 负责人批准 APPROVED
  -> 可选废弃 DEPRECATED
```

资料内容始终视为不可信数据，永不 `eval`、动态加载或生成 JS。字段证据绑定 SHA-256、版本、页码、bbox、引文及置信度；修订采用 append-only 哈希链。只有最新 `APPROVED` 记录可导出。当前工作台与生产 `engine/` 隔离，导出目录不会被自动加载；未来若建立集成层，也只能按受控 DeviceClass/FunctionalPort/PhysicalTerminal 映射读取，router 不参与补接线。

## 6. 仍然保留的人类责任

自动检查证明的是“输入契约、模型、电气规则子集、图形和导出之间一致”，不是证明产品满足全部标准。供电短路容量、保护整定与选择性、EMC、温升、绝缘配合、器件型式试验、消防、并网许可和最终标准适用版本必须由项目专业人员完成。
