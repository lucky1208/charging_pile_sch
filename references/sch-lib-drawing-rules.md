# EDEM / Drawing IR 完整性规则包

运行时入口：`window.EVSE_DRAWING_SKILL`，当前版本 3.0。

`sch_lib` 参考图只用于形成工程表达的候选规则，不再用固定坐标、颜色值或文本正则判断电气正确性。规则执行顺序是：

1. `EVSE_ERC.validate(design)` 检查 EDEM v4 的实例、物理端子、网络、电气域和回路；
2. `EVSE_SCHEMATIC_PLACEMENT.compile(design)` 产生放置与路由；
3. `EVSE_DRAWING_IR.auditCoverage(design, ir)` 校验设备、网络、回路和精确端点覆盖；
4. Drawing IR 全局检查交叉、连接点、共线重叠、自交与 keepout；
5. SVG 审计核对 A3 文控、IR schema、coverage、geometry hash 和追溯属性；
6. `canExport()` 汇总需求、ERC、IR 与 SVG 审计，任一阻断则禁止 SVG/DXF。

## 机器执行规则

### ERC

- `ERC-001`：实例、物理端子、定义状态与 ID；
- `ERC-010`：网络及端点存在性、端子单网络归属；
- `ERC-020`：netClass、domain、phase、polarity、voltage、protocol 与源/负载兼容；
- `ERC-030`：必接端子覆盖；
- `ERC-040`：回路与网络端点等价、网络连通；
- `ERC-050`：充电接口 DC+/DC−/PE 极性与隔离。

### 几何与覆盖

- `G037`：同网交叉为 junction，不同网交叉为 bridge，统一在全局后处理完成；
- `G043`：无共线重叠、无自交；
- `G045`：无 route/keepout 穿越；
- `G046`：通道容量与 lane 分配可行；
- `G047`：EDEM 与 Drawing IR exact coverage；
- `G048`：SVG/DXF 保留 equipment/net/circuit/endpoint 追溯。

### 文档

- `DOC-001`：完整 A3 SVG、图号、修订、校核/批准字段、图例与明细表；
- `DOC-002`：IR schema、coverage PASS 与 geometry hash；
- `DOC-003`：无 `NaN`、`Infinity`、`undefined`；
- `DOC-004`：方案级输出的人工审查边界。

`selectedRuleIds` 表示适用规则，`evaluatedRuleIds` 只记录本次真正执行的机器检查，`skippedRuleIds` 明确列出仍待渲染或只能人工处理的项目。

## 参考图不能证明的内容

- 标准符合性或认证；
- 器件额定值、料号、短路分断能力和保护整定；
- 电缆载流、压降、热稳定、EMC 与温升；
- 样本颜色、坐标、字号或布局是强制标准；
- 两个端子因名称相似即可等价。

正式实现与矩阵结果见 `docs/P2-DRAWING-IR-VERIFICATION.md`。
