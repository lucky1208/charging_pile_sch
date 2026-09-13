---
name: evse-schematic-design
description: 生成充电桩（EVSE）方案级端子原理图与工程附件：将 GB/T、CCS2、CCS1、NACS、CHAdeMO 及直流一体、直流分体、交直流一体、储能移动桩需求编译为 EDEM v4 端子网表，经 ERC、闭环追踪、确定性布线和最终 SVG/DXF 反读闸门后输出六页图册、BOM、逐 PIN 接线、RFQ 与审计证据。
version: 2.7.1
author: 卢继雄
created_at: 2026-08-18
updated_at: 2026-09-13
---

# 充电桩端子级电气原理图自动设计

平台把需求确定性地编译为端子级电气模型，再从同一模型生成 SVG 与 DXF。AI 只可翻译自然语言需求，或在独立工作台中从器件资料生成待审核草稿；AI 不决定器件档位、不猜接线、不生成坐标，也不能把草稿器件直接激活。

## 工程边界

所有输出状态均为 `CONCEPT_DRAFT—PROFESSIONAL_REVIEW_REQUIRED`：

- 不是生产图、施工图、设备报价、保护整定书、型式试验结论或标准符合性证明；
- 短路、保护配合、EMC、温升、绝缘、电池安全、消防、并网与接口一致性仍须由具备资格的人员完成；
- 未经审核批准的厂家器件资料不能参与自动接线；
- 任一需求、ERC、几何或图模覆盖闸门失败时，不得交付 SVG/DXF。

交付回复末尾声明：`本图为方案级概念草图，须经电气专业复核；不构成生产/施工图或合规证明。`

## 已实现范围

- 接口：`gb`、`eu`、`us`、`nacs`、`chademo`；
- 桩型：`dc-integrated`、`dc-split`、`ac-dc-combo`、`ess-mobile`；
- 充电枪：1–4；
- 储能：无储能、DC/DC 直流耦合、PCS 交流耦合；
- 在线编辑：端子级器件/回路/标注对象选择，窗口/交叉框选，多选成组移动，可配置捕捉网格，方向键微调，对齐、等距分布，以及事务式撤销/重做；
- 未知枚举、缺失必需储能/端子、未通过 ERC、几何或图模覆盖的组合必须 fail-closed，不得回退到“最相近”的标准或桩型。
- 所有携带 `route/net/circuit` 身份的电气连接均须以连续实线输出到 SVG 与 DXF；控制、通信用颜色、图层和文字区分，虚线仅限机械联动、光路及辅助边界。G050 / PAGE-Q13 无法证明该条件时必须阻断交付。

## 数据流

```text
RequirementSpec（来源/置信度/未决项/人工确认）
  -> 确定性选型
  -> 受控 DeviceClass + physical terminals
  -> EDEM v4 instances / nets / exact circuits
  -> ERC + 同一物理电源输出对/PE 闭环追踪
  -> placement + channel/lane router
  -> Drawing IR + coverage + geometry + 文字 clearance audit
  -> SVG renderer / DXF exporter
  -> 最终 SVG / DXF 独立反读
```

其中 AC 的 L1/L2/L3/N、DC+/DC−、PE、24V/0V 和 12V/0V 均为独立电气网络。DXF 主路径直接消费 Drawing IR，不解析 SVG 来重建几何。

## 模式 A：命令行生成

1. 只提取用户明确给出的需求。字段、枚举和默认值见 `references/parameters.md`；未知专项要求原文放入 `specialRequirements`。
2. 把参数保存为 UTF-8 JSON，例如 `params.json`。
3. 在 Node.js 24.x 运行（`component-workbench/` 仍兼容 Node.js 20 以上）：

   ```powershell
   node <skill目录>\scripts\generate.js --params params.json --out <输出目录> --name <文件名前缀>
   ```

4. 自动翻译低于置信度阈值、缺失置信度或仍有未决项时，必须先让用户复核，再设置 `requirementConfirmed=true` 或显式传入 `--confirm-requirements`。
5. 退出码：

   - `0`：S01–S06 六页 SVG、六页 DXF、全项目 JSON、BOM、逐 PIN 接线、RFQ 和审计证据均已通过方案级导出闸门；文件名为 `<前缀>_EVSE-01..06.*`、`<前缀>.json` 与 `<前缀>_{BOM,WIRING,RFQ,AUDIT}.*`；
   - `1`：输入、实现范围或人工确认闸门失败；
   - `2`：ERC、Drawing IR、图模覆盖或渲染审计失败；只保留 JSON 诊断，不交付图纸。

## 模式 B：Web 表单

```powershell
npx serve <skill目录>\web
```

浏览器打开本地地址。此静态启动方式可使用表单、本地规则需求解析和确定性多页出图；参数、元器件库和“属性 / PIN / 网络”位于图纸上方的横向控制台，可整体收起。发布仓库中的 `api/ai.js` 可在 Vercel 上提供同源 AI 需求翻译代理，模型密钥仅通过服务端环境变量配置；所有 AI POST 还要求站点配置不少于 32 字节的 `ENGINEERING_API_ACCESS_TOKEN`，浏览器只在本页内存持有用户输入的访问令牌。静态服务不可用时安全回退本地解析。Web 加载由 `engine/` 生成的 bundle，CLI 按同一受控顺序直接加载这些 `engine/` 模块和同一个六页编译器；两者不再维护第二份手工核心代码。任何 `engine/*.js` 改动后必须执行：

```powershell
npm run verify
```

## 在线对象编辑安全语义

Web 编辑器允许点击、Shift 增选、Ctrl/Cmd 切换、左右向框选，以及器件/图注成组拖动、网格方向键微调和器件对齐/等距分布。导线可选择和检查，但不得以成组平移方式脱离 PIN；现有导线只允许受约束的中间线段编辑。每条编辑命令必须作为原子事务执行：保持设备、端口、网络、回路、物理引用与别名追踪的电气身份不变；已覆盖 Drawing IR 必须携带当前 EDEM 模型并重新通过 coverage 与几何审计。任一失败必须恢复命令前几何且只产生一条撤销记录。

## 元器件资料工作台（P3）

`component-workbench/` 用于把 PDF 外部抽取文本、TXT 或 JSON 资料变成声明式候选，并执行：

```text
EXTRACTED_DRAFT -> REVIEWED -> APPROVED -> DEPRECATED
```

每个字段必须保存源文件 SHA-256、文档版本、页码、bbox、原文证据和置信度。`UNKNOWN`、低置信度、缺证据或映射不一致都会阻断批准；只有最新 `APPROVED` 修订可导出受控 JSON，工作台永不执行上传内容或生成 JS。工作台当前与生产 `engine/` 隔离，导出结果不会自动进入器件目录。命令与格式见 `component-workbench/README.md`。

## 典型参数

```json
{
  "pileName": "示范站 240kW 双枪储能充电桩",
  "site": "上海",
  "standard": "gb",
  "archetype": "dc-integrated",
  "outputKw": 240,
  "gunCount": 2,
  "gunCurrentA": 250,
  "moduleKw": 40,
  "voltageWindow": "200-1000",
  "thermal": "liquid",
  "essEnabled": true,
  "essKwh": 200,
  "essPowerKw": 120,
  "essCoupling": "dc",
  "specialRequirements": ["沿海高盐雾环境，防腐等级待项目确认"]
}
```

## 验证

```powershell
npm run verify
```

根测试会发现 216 矩阵和工作台测试。需要定位问题时可分别重跑：

```powershell
npm run test:matrix
npm run test:p3
```

2026-08-28 的 2.2 历史发布基线为全套测试 `171 / 171`。2026-08-30 的 2.3 受控本地证据基线为 `178 / 178`；当时公共发布工作树另含 11 项 API 代理测试，结果为 `188` 通过、`1` 项外部原图哈希检查按设计跳过、失败 `0`。2026-08-31 的 2.4 本地全量基线为 `186 / 186`，新增器件硬避让、图框边界、回路级挤推、预览不变性与 PIN 对端检查；同版本公共发布工作树包含 API 代理测试，总计 `196` 通过、失败 `0`、`1` 项外部原图哈希检查按设计跳过。2026-09-03 的 2.5 本地全量基线为 `198 / 198`，新增多选、左右向框选、成组编辑、动态网格、对齐/分布、电气身份不变性、会话不可变性和历史上限验证；公共发布工作树总计 `209` 项，其中 `208` 通过、失败 `0`、`1` 项外部原图哈希检查按设计跳过。216 参数矩阵继续 `216 / 216` 通过。矩阵覆盖 `3 标准 × 3 功率 × 4 枪数 × 3 储能模式 × 2 热管理` 的直流一体式高密度参数回归；另以 `5 接口 × 4 桩型 = 20` 个组合验证每种端子级拓扑契约。各基线用途不同，完整结果见 `docs/` 下验收报告。

## 禁止事项

- 不直接改写生成 SVG/DXF；在线编辑只能提交受 schematic-editor 事务、几何与图模覆盖闸门验证的 Drawing IR 几何变更；拓扑变化须修改受控 EDEM 后重新编译；
- 不绕过需求确认、ERC、几何、coverage 或导出闸门；
- 不把 PE、功能地、机壳地、信号地或 DC− 互相归一化；
- 不用编辑距离或 LLM 猜测端子等价、极性、相别、协议或接线；
- 不把标准名称当作自动合规结论。
