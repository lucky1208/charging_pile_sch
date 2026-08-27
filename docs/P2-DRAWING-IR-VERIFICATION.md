# P2 IEC 符号、Drawing IR 与确定性布线验收报告

日期：2026-08-28

状态：PASS（方案级自动草图，仍须电气专业校核与签发）

## 结果

- 核心源码与元器件工作台测试 `160 / 160` 通过；公开发布克隆连同既有 `/api/ai` 代理安全测试最终 `171 / 171` 通过，失败、跳过、取消均为 0；总耗时 `480.93 s`。
- 正式参数矩阵：`216 / 216` 通过，失败 0；发布克隆最终矩阵耗时 `474.41 s`。
- P2、DXF、可读布局及源码同步定向回归全部通过。
- `engine/` 的 20 个核心模块全部进入确定性 Web bundle，并由内容哈希校验同步。
- 66 个受控设备种类全部具有显式非 fallback 的原生矢量符号映射。
- 五接口×四桩型的 20 个端子级拓扑契约组合全部通过模型验证；五套跨标准、跨桩型 CLI 产物均通过 SVG/DXF 导出闸门。

正式 216 矩阵是直流一体式的高密度参数回归：

```text
3 标准（GB / CCS2 / CCS1）
× 3 功率（60 / 120 / 240 kW）
× 4 枪数（1 / 2 / 3 / 4）
× 3 储能模式（无 / DC 耦合 / AC 耦合）
× 2 热管理（风冷 / 液冷）
= 216
```

另有独立的 `5 接口 × 4 桩型 = 20` 拓扑契约回归，覆盖 GB/T、CCS2、CCS1、NACS、CHAdeMO 与直流一体、直流分体、交直流一体、储能移动。该组回归验证每种模板的端子与拓扑契约；它不是功率、枪数等参数的穷举矩阵。

216 矩阵的每个组合均实际执行 EDEM v4.1 构建与 ERC、placement、route、Drawing IR exact coverage、全局几何违规检查、SVG 渲染、drawing-skill audit/finalize，以及 SVG/DXF `canExport` 闸门。另对覆盖全部矩阵标准、储能模式与枪数边界的 18 组组合实际序列化 DXF；DXF primitive 一致性与破坏变异由专项测试验证。

执行命令：

```powershell
node --test tests/geometry-matrix.test.js
npm run sync:web
node --test tests/source-sync.test.js
npm test
```

## IEC 风格原生符号

- 受控设备目录中的 66 个 kind 与符号目录精确一致，任何已知 kind 都不得使用通用 fallback。
- 基础设备使用可识别的电气图形：断路器含动触点与脱扣、熔断器含熔体、电阻含电阻体、电池含正负极板、PE 含接地横线、指示灯含灯丝、连接器含针脚。
- 组合设备可使用带功能码的 IEC 风格功能框，但不会把所有元器件降级成同一种方框。
- 符号目录只产出 line、polyline、circle、arc、rect、text 等 renderer-neutral 图元，不嵌入 PNG、base64、`<image>` 或外部 SVG。
- Drawing IR、SVG 和 DXF 使用同一组 symbol primitive，并保存 `symbolId`、`symbolRole` 与 `equipmentId` 追溯。

## 唯一拓扑与几何数据流

```text
design.instances / design.nets / design.circuits
  -> EVSE_SCHEMATIC_PLACEMENT.compile
  -> EVSE_DRAWING_IR
  -> SVG renderer
  -> DXF exporter
```

`draw-pile.js` 不再读取 `R.ac`、`R.dc`、`R.guns`、`R.ess` 或 `R.aux` 重画拓扑，也不存在绕过 Drawing IR 的裸 `wire` 路径。SVG 与 DXF 消费同一个毫米坐标 Drawing IR。

## 核心 API

浏览器全局：`window.EVSE_DRAWING_IR`

- `createPlacedDevice(spec)`：生成带端口锚点、keepout 与原生符号图元的放置设备。
- `allocateIntervalLanes(intervals, options)`：确定性、最少 lane 的区间图着色；容量不足时 fail-closed。
- `assignChannelLanes(channel, intervals, options)`：把逻辑 lane 映射为通道物理坐标。
- `routeOrthogonal(spec)`：生成仅含水平/垂直线段的精确端点 Route。
- `analyzeGeometry({ devices, routes })`：全局分类 junction、bridge、非法接触、共线重叠与 keepout 穿越。
- `postProcessCrossings(spec)`：在全部几何完成后统一处理交叉，结果与绘制顺序无关。
- `auditCoverage(model, drawing)`：校验物理设备、网络、回路、route 数量及 exact terminal endpoints。
- `buildDrawingIR(spec)` / `assertValidDrawingIR(ir)` / `drawingIRHash(ir)`：建立、验证并稳定散列 renderer-neutral IR。

浏览器全局：`window.EVSE_SCHEMATIC_PLACEMENT`

- `compile(design)`：只从 EDEM v4.1 的 `instances(terminals)`、`nets.members`、`circuits exact endpoints` 生成 placement、routes 与 Drawing IR。
- 元数据代理不会被误画成第二个物理设备；NACS 储能移动用例的 AC/DC 逻辑入口在模型中保留追溯，但 Drawing IR 只放置一个共享入口及其模式选择器。

浏览器与 CommonJS：`EVSE_DXF`

- `exportDrawingIR(ir, options)` / `fromIR`：直接从 Drawing IR 输出 DXF R2010。
- `exportSvgLegacy` / `fromSvg`：仅保留旧调用兼容，并明确返回 `LEGACY_SVG_PARSE` warning。

## 可追溯性与失败关闭

- SVG route 带 `data-route`、`data-net`、`data-circuit`、`data-from`、`data-to`；设备带 `data-equipment` 和符号追溯属性。
- SVG 根带 Drawing IR schema、coverage 状态与 geometry hash。
- DXF 用注册 APPID `EVSE_IR` 的 XDATA 保存 primitive、equipment、port、route、net、circuit 与端点映射，同时写入 `EVSE-DXF-IR-MANIFEST` 注释元数据。
- DXF manifest 明确报告 `DXF_XDATA_AND_COMMENT_METADATA`；两条追溯载体必须与 Drawing IR 一致。
- 任一 schema 错误、coverage 缺失、route/primitive 不一致、lane 容量溢出、非法交叉、共线重叠或 keepout 穿越都会阻断导出。

## 五套代表产物

| 用例 | 模型实例 | 物理设备 | 网络 | 回路/Route | 结果 |
|---|---:|---:|---:|---:|---|
| GB / 直流一体 | 35 | 35 | 74 | 131 / 131 | SVG/DXF PASS |
| CCS2 / 储能移动 | 72 | 72 | 119 | 241 / 241 | SVG/DXF PASS |
| CCS1 / 交直流一体 | 50 | 50 | 93 | 180 / 180 | SVG/DXF PASS |
| NACS / 储能移动 | 76 | 74 | 120 | 241 / 241 | SVG/DXF PASS |
| CHAdeMO / 直流分体 | 39 | 39 | 95 | 156 / 156 | SVG/DXF PASS |

NACS 的模型实例数与物理设备数相差 2，是因为 AC/DC 逻辑代理不生成第二套入口符号；exact circuit/route coverage 仍为 PASS。

## 工程边界

P2 PASS 证明模型、路由、符号图元和两种导出之间的一致性，不代表图纸已经完成短路计算、保护配合、绝缘/EMC/温升验证、型式试验或标准认证。高密度单页仍需通过多页图册、跨页连接器和同网干线合并继续工程化；输出仍是 `CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED`。
