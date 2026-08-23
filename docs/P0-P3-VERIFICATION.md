# EVSE Schematic Design 2.0 — P0–P3 最终验收报告

日期：2026-08-19  
平台：Windows / Node.js 24.19.0 / npm 11.17.0  
结论：PASS（方案级自动草图；仍须电气专业复核与签发）

## 1. 最终统一回归

在完成全部源码修改、对抗加固和 Web 同步后执行：

```powershell
npm run sync:web
npm test
```

最终结果：

- 全套测试 `92 / 92` 通过，失败、跳过、取消均为 `0`；总耗时 `138.80 s`。
- 216 组合正式矩阵 `216 / 216` 通过，失败 `0`；矩阵耗时 `136.81 s`。
- 66 个 JavaScript 文件通过 `node --check` 语法检查。
- `engine/` 的 18 个核心模块与 Web 镜像逐字节一致；bundle 可确定性重建，无缺失或孤儿核心镜像。
- Web 的 `engine-bundle.js` 与 `app.js` 查询版本均由各自 SHA-256 内容哈希生成。

216 组合覆盖：

```text
3 标准（GB / EU / US）
× 3 功率（60 / 120 / 240 kW）
× 4 枪数（1 / 2 / 3 / 4）
× 3 储能模式（无 / DC 耦合 / AC 耦合）
× 2 热管理（风冷 / 液冷）
= 216
```

每个组合均执行 EDEM v4 构建、ERC、placement、route、Drawing IR exact coverage、全局几何检查、SVG 渲染、drawing audit、SVG/DXF 导出闸门；18 个边界组合还实际序列化 DXF。

## 2. P0 输入与运行时

- RequirementSpec、Web 与 CLI 共用同一契约、默认值和 capability gate。
- 显式非法数字、布尔、`null`、空串、越界值不再静默回退。
- “无储能/不带储能”、GB/EU/US 电压联动和 NACS/CHAdeMO 识别均通过专项测试。
- 低置信度、缺置信度或有未决项时必须人工确认；原始自然语言进入最终 EDEM 来源记录但只按纯数据处理。
- 改造期间的真实浏览器 E2E 中，GB 1–4 枪均为 drawing audit `CHECKED`、coverage `PASS`；NACS 与未实现桩型明确 fail-closed。最终同步后又完成了 bundle VM 加载、Web 合约和内容哈希校验；当次复跑真实浏览器时测试基础设施没有可用浏览器实例，因此没有把它虚报为第二次浏览器通过。

## 3. P1 电气真值与 ERC

- EDEM v4 使用真实导体级端子：L1/L2/L3/N、DC+/DC−、PE、24V/0V、12V/0V及标准枪针脚均独立。
- P1 基线与对抗测试 `13 / 13` 通过；所有破坏变异都会先重算 `modelHash`，因此结论来自语义 ERC，而不是仅靠哈希不一致。
- 已验证阻断：相别/极性/电压域/协议/信号角色篡改，P/N、CP/PP、CC1/CC2 互换，端子与兼容副本分叉，定义或审批缺失，回路语义缺失，以及储能预充和并网保护顺序错误。
- 受控 connector 类型不存在时返回失败，不再回退成 CCS2。

## 4. P2 Drawing IR、路由与导出

- 唯一数据流为 `EDEM v4 -> placement/router -> Drawing IR -> SVG/DXF`；渲染器不再依据标量或魔法坐标重建拓扑。
- exact circuit 与 route 一一对应；lane 容量、keepout、异网接触、共线重叠和非法交叉均 fail-closed。
- SVG 以 `data-*`、DXF 以 `EVSE_IR` XDATA 保存设备、端子、网络、回路、路线和几何哈希追溯。
- CLI 和 Web 的 DXF 主路径只接受 Drawing IR，不再从 SVG 反解析。

## 5. P3 元器件资料工作台

- 安全与生命周期专项测试 `23 / 23` 通过。
- 路径穿越、Windows 保留设备名、symlink/junction、TOCTOU、输出覆盖、非法 UTF-8、重复 JSON 键和恶意 JS 输入均被阻断。
- 跳级、回退、自审自批、哈希断链、孤立或非规范修订、重算哈希后的语义篡改均被阻断。
- 只有完整历史中的最新 `APPROVED` 修订可导出；`UNKNOWN` 或证据不完整不得批准或自动接线。
- PDF 文本证据按页核验；bbox 与工程结论仍由独立审核人确认。

## 6. CLI 黑盒产物验收

最终回归后实际生成并解析两套 SVG/DXF/JSON 方案包：

| 用例 | 实例 | 网络 | 回路 | Route | ERC | Coverage | 几何违规 | SVG/DXF |
|---|---:|---:|---:|---:|---|---|---:|---|
| GB 240 kW、4 枪、液冷、无储能 | 48 | 102 | 172 | 172 | PASS | PASS | 0 | PASS / PASS |
| EU 120 kW、2 枪、风冷、AC 耦合储能 | 50 | 101 | 177 | 177 | PASS | PASS | 0 | PASS / PASS |

两套输出均为 `EVSE-SOLUTION-PACKAGE/1.0` + EDEM v4 + `evse-drawing-ir/v1`；SVG 的 schema、route count、geometry hash 与 JSON 一致，DXF 为 AC1024/R2010 且含 `EVSE_IR`，未使用 `LEGACY_SVG_PARSE`。

## 7. 安全与工程边界

本次验收证明的是输入契约、受控目录、端子级模型、已实现 ERC 子集、几何 IR 和导出之间的一致性，不等同于标准符合性或施工可用性。短路容量、保护整定与选择性、绝缘配合、EMC、温升、型式试验、消防、并网审批和最终版本适用性仍必须由专业人员完成。

P3 的本地 SHA-256 修订链也不等同于数字签名或 WORM。若需要抵抗拥有整个 store 写权限的攻击者，应接入组织级签名、权限分离和不可变审计存储。
