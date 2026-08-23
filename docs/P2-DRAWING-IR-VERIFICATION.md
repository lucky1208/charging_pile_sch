# P2 Drawing IR 与确定性布线验收报告

日期：2026-08-19  
状态：PASS（方案级自动草图，仍须电气专业校核与签发）

## 结果

- 正式参数矩阵：216 / 216 通过，失败 0。
- 矩阵耗时：111.55 s（Node test 总耗时 111.92 s）。
- 单一源码同步检查：4 / 4 通过。
- P2 几何、集成和 DXF 专项基线：26 / 26 通过。
- 改造前同等级矩阵约 296.6 s；在不减少 216 组全链闸门的前提下缩短约 62%。

正式矩阵为：

```text
3 标准（GB / EU / US）
× 3 功率（60 / 120 / 240 kW）
× 4 枪数（1 / 2 / 3 / 4）
× 3 储能模式（无 / DC 耦合 / AC 耦合）
× 2 热管理（风冷 / 液冷）
= 216
```

每个组合均实际执行：EDEM v4 构建与 ERC、placement、route、Drawing IR exact coverage、全局几何违规检查、SVG 渲染、drawing-skill audit/finalize，以及 SVG/DXF `canExport` 闸门。另对覆盖全部标准、储能模式与枪数边界的 18 组组合实际序列化 DXF；DXF primitive 一致性与破坏变异由专项测试穷举验证。

执行命令：

```powershell
node --test tests/geometry-matrix.test.js
npm run sync:web
node --test tests/source-sync.test.js
```

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

- `createPlacedDevice(spec)`：生成带端口锚点和 keepout 的放置设备。
- `allocateIntervalLanes(intervals, options)`：确定性、最少 lane 的区间图着色；容量不足时 fail-closed。
- `assignChannelLanes(channel, intervals, options)`：把逻辑 lane 映射为通道物理坐标。
- `routeOrthogonal(spec)`：生成仅含水平/垂直线段的精确端点 Route。
- `analyzeGeometry({ devices, routes })`：全局分类 junction、bridge、非法接触、共线重叠与 keepout 穿越。
- `postProcessCrossings(spec)`：在全部几何完成后统一处理交叉，结果与绘制顺序无关。
- `auditCoverage(model, drawing)`：校验设备、网络、回路、route 数量及 exact terminal endpoints。
- `buildDrawingIR(spec)` / `assertValidDrawingIR(ir)` / `drawingIRHash(ir)`：建立、验证并稳定散列 renderer-neutral IR。

浏览器全局：`window.EVSE_SCHEMATIC_PLACEMENT`

- `compile(design)`：只从 EDEM v4 的 `instances(terminals)`、`nets.members`、`circuits exact endpoints` 生成 placement、routes 与 Drawing IR。

浏览器与 CommonJS：`EVSE_DXF`

- `exportDrawingIR(ir, options)` / `fromIR`：直接从 Drawing IR 输出 DXF R2010。
- `exportSvgLegacy` / `fromSvg`：仅保留旧调用兼容，并明确返回 `LEGACY_SVG_PARSE` warning。

## 可追溯性与失败关闭

- SVG route 带 `data-route`、`data-net`、`data-circuit`、`data-from`、`data-to`；设备带 `data-equipment`。
- SVG 根带 Drawing IR schema、coverage 状态与 geometry hash。
- DXF 用注册 APPID `EVSE_IR` 的 XDATA 保存 primitive、equipment、port、route、net、circuit 与端点映射。
- 任一 schema 错误、coverage 缺失、route/primitive 不一致、lane 容量溢出、非法交叉、共线重叠或 keepout 穿越都会阻断导出。

