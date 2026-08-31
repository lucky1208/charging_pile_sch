# EVSE Schematic Design 2.4 — 在线编辑路由增量验收

验收日期：2026-08-31

版本：2.4.0

编辑内核：`EVSE_SCHEMATIC_EDITOR 2.0.0`
局部路由内核：`EVSE_SCHEMATIC_EDIT_ROUTER 1.0.0`

## 1. 验收结果

在 `D:\charging_pile\gpt\evse-schematic-design-1.0.14` 执行：

```powershell
npm run build
npm test
```

结果：

- 全量测试：`186 / 186` 通过；失败 0；跳过 0；
- 216 高密度参数组合：`216 / 216` 通过；
- 五接口 × 四桩型：`20 / 20` 通过；
- Web bundle：由 27 个 `engine/*.js` 模块确定性生成，源/镜像字节一致；
- 216 矩阵耗时：507343 ms；全量耗时：512302 ms。

发布到 GitHub 的完整工作树另外包含 11 项 Vercel API 代理测试。对发布树执行同一套 `npm test` 的最终结果为：总计 197 项，`196` 通过、失败 `0`、`1` 项按设计跳过；跳过项仅检查未随公共仓库分发的客户原始 SVG 文件哈希。发布树的 216 参数矩阵仍为 `216 / 216` 通过，矩阵耗时 468646 ms，全量耗时 473021 ms。

## 2. 新增编辑能力验收

| 能力 | 验收结果 |
|---|---|
| 器件拖动逐 PIN 跟线预览 | PASS；预览不修改 revision、history 或几何哈希 |
| 器件落点自动避让 | PASS；重布相连回路及被新器件占用的无关回路 |
| 器件硬障碍 | PASS；无穿器件 fallback，最小硬净距 1 图纸单位 |
| 图纸边界 | PASS；路由不得绕出 Drawing IR sheet bounds |
| 中间线段挤推 | PASS；用户线锁定，冲突回路整条重布并迭代收敛 |
| PIN 网络检查 | PASS；展示 net、circuit、route 与精确对端 PIN |
| 事务回滚 | PASS；碰撞、越界、无路径、锁定线违规时哈希不变 |
| 撤销/重做/取消 | PASS；按钮与 Ctrl/Cmd 快捷键均走完整 Drawing IR 历史 |
| CAD 图层 | PASS；宽屏库与右侧属性栏开关同步 |
| SVG/DXF/JSON 同源 | PASS；编辑后仍由当前 Drawing IR 直接导出 |

## 3. 浏览器实测

使用本地静态 Web 默认参数生成 120 kW 国标双枪图：42 个器件、162 条回路。

- 实拖 `EQ-AC-QF1`：提交 `MOVE_DEVICES`，自动复核/重布 13 条回路；
- 提交后 Drawing IR 哈希由 `fnv1a32:1938a898` 变为 `fnv1a32:bc8aae8a`；
- 图纸审计状态保持 `CHECKED`；
- `Ctrl+Z` 恢复原哈希 `fnv1a32:1938a898`；
- 实拖 `CCT-0003` 中间正交段：提交 `MOVE_ROUTE_SEGMENT`，哈希变为 `fnv1a32:2f720f58`，审计保持 `CHECKED`；
- PIN 属性正确显示 `EQ-AC-QF1:IN_L1` 经 `NET-0003 / CCT-0003` 到 `EQ-AC-QS1:OUT_L1`；
- `EVSE-CTL` 图层关闭后，同名图层对象全部带受控隐藏标记，两个控制入口状态同步；
- 浏览器控制台错误：0。

## 4. 回归不变量

2.4 没有改变自动生成时的 EDEM、placement 或 Drawing IR 路由算法；新路由器只在编辑事务中调用。因此：

- 相同生成输入仍产生相同初始模型和几何哈希；
- 既有 216 参数矩阵完全复用且全部通过；
- 编辑器不创建、不删除、不猜测任何网络；
- source/target 的设备、PIN、physicalRef、netId、circuitId 始终来自已有 EDEM；
- 每次编辑后的 coverage 必须证明图中的每条回路仍等于模型；
- 找不到合法几何只能拒绝，不能降级成交叉器件或图框外导线。

## 5. 验收边界

本报告证明“已有端子级模型上的对象移动和局部正交重布”按已实现规则保持几何及模型一致；不证明多页工程图、交互式电气建模、完整实时 lane 推挤、短路/保护选择性、EMC、温升、绝缘配合、型式试验或最终标准符合性。完整迁移取舍见 [Claude 在线 EDA 参考代码审计与 2.4 集成说明](CLAUDE-EDA-REFERENCE-INTEGRATION.md)。
