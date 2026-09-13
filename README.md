# SchematicForge EVSE 2.7.1

这是一个方案级充电桩电气设计编译器。输入经过需求确认后，被编译为 EDEM v4.1 端子级网表；SVG 和 DXF 都从同一 Drawing IR 生成，并由 ERC、几何与图模覆盖闸门 fail-closed。

> 输出仅用于方案比较与工程深化输入，须经电气专业复核和签发；不构成生产图、施工图或合规证明。

## 本次 P0–P3 改造

- **P0 — 输入与运行时**：Web/CLI 共用 `RequirementSpec`；修复“无储能”、标准电压联动和标准识别；低置信度/未决项要求人工确认；非法标准与桩型明确阻断；`engine/` 成为唯一核心源码。
- **P1 — 电气真值**：EDEM v4.1 明确建模 L1/L2/L3/N、DC+/DC−、PE、24V/0V、12V/0V、枪针脚、接触器线圈和储能原子保护器件；新增受控设备类目录与端子级 ERC。
- **P2 — 几何与导出**：确定性 placement、通道与区间图 lane 分配、正交路由、全局交叉后处理、keepout、Drawing IR 和 exact coverage；SVG/DXF 同源且保留可追溯 ID。
- **P3 — 器件导入**：安全的资料草稿、证据、审核、批准、废弃和受控 JSON 导出工作台；上传内容永不作为代码执行。
- **IEC 符号与产品变体**：66 类原生 Drawing IR 矢量符号取代统一方框；五种接口和四种桩型分别编译受控端子与拓扑。只有受控且已批准的项目结论可以进入生成模型；本轮两份真实项目图的部分追线结果只进入只读证据库、诊断与回归，不参与自动拓扑选择。原始客户图和包含其逐线细节的本地证据文件不随公共仓库发布。
- **控制导引与输出安全诊断**：每个适用物理接口建立 CP 发生、高阻采样和车辆二极管检查；每个输出建立接触器下游逐导体预检、接触器反馈/粘连监测与 fail-closed 状态机。板级器件值、阈值和时序保持项目待决。
- **Qwen 参考迁移**：保留 7 类/32 个候选拓扑作为只读知识，不自动选型；拒绝第二套手绘网表、主观评分和字符串自证闸门。证据与取舍见 [Qwen 参考代码审计与迁移](docs/QWEN-REFERENCE-MIGRATION.md)。
- **用户项目证据与真实系统参考**：完整索引 79 页 `对比.docx`，重建 29 类板级矢量符号、7 个详细 PIN→PIN 功能模板（108 条板级逻辑端点连线），并把欧标储能图与国标 60kW 图整理为 2 份只读、部分追线的系统参考（70 个器件、185 条端点关系、9 个功能单元）。其中 56 条来自可读端子标注，120 条来自可见走线但仍含聚合端口，9 条是明确标记的功能推断；当前仍有 100 个未决项，结构校验通过不等于逐 PIN 提取完整。封装物理脚号缺失的多 PIN 器件会报告 `PACKAGE_PIN_MAP_REQUIRED`，任何参考实例都禁止自动成为产品拓扑。
- **在线对象化编辑 2.1**：器件拖动时逐 PIN 导线实时跟随，落点后以器件为硬障碍进行确定性正交重布；移动中间线段时锁定用户线并挤推重布冲突回路。新增 Shift 加选、Ctrl/Cmd 切换选择、左右向窗口/交叉框选、成组拖动、可配置捕捉网格、方向键微调、器件对齐和等距分布；一组对象始终作为单个事务提交并可一步撤销。属性栏显示网络、回路和对端 PIN，支持 CAD 图层、器件碰撞/越界检查与事务回滚。编辑器固定模型哈希并比较端子级电气身份，任何命令都不能暗改器件、PIN、网络、回路或端点关系；无合法路径时绝不穿器件交付。2.6 已支持各功能页独立几何编辑，但仍不支持未经 EDEM 校验的新建/删除网络、跨页改接、旋转或镜像。
- **Claude EDA 参考审计**：吸收对象命中、局部重布、稀疏正交寻路、标签软避让、图层、框选与键盘工作流；拒绝穿器件 fallback、客户端密钥、猜测网络域、只保存坐标的伪撤销和可掩盖几何失败的评分。证据、实测缺陷、迁移内容与剩余边界见 [Claude 在线 EDA 参考代码审计与 2.4–2.5 集成说明](docs/CLAUDE-EDA-REFERENCE-INTEGRATION.md)。
- **2.6 多页工程投影**：一个不可变 EDEM 被投影成 S01–S06 六张固定功能页；内部回路恰好出现一次，跨页回路由成对连接器表示两次并保留全局器件/PIN、远端页号和图号。高扇出器件可拆为多个可追溯图形单元，空功能页也保持稳定页号；页面编辑分别保存，任一页或项目覆盖闸门失败即禁止工程导出。
- **2.6 审图与工程 BOM**：用户可上传 PNG/JPEG/WebP/SVG/PDF/JSON 发起 AI 辅助审图，确定性 ERC/几何/覆盖结论优先，AI 只能形成待复核候选。BOM 固定输出位号、类别、设备名称、型号、参考推荐厂家、关键参数、数量和说明手册下载；联网检索只产生带证据的候选，未显式批准的型号、厂家和链接不会进入主 BOM。
- **2.6 知识维护与工作台**：参数、元器件库及“属性 / PIN / 网络”组成图纸上方的全宽横向控制台，可一次收起让图纸占满窗口，也可单独收起属性检查器并支持全屏；主回路、PE、控制和通信使用不同线宽、颜色、图层和文字标识。每周只读任务检查已批准资料链接并收集标准、EOL/PCN、替代料和调试经验候选，始终执行 `CANDIDATE → REVIEWED → APPROVED` 人工晋级，不自动修改生产规则。
- **2.7 最终产物反读与回路闭环**：新增 G049 最终 SVG 独立解析，对每段导线、跨线、端子、符号、文字、命中层和页面骨架逐项回指 Drawing IR；新增 DXF `ENTITIES + EVSE_IR XDATA` 独立反读。辅助正负回路、线圈回流、公共端和 PE 沿真实 circuit 追踪到同一物理电源输出对，不能再用同名网络或缓存 PASS 自证。
- **2.7 图面与交付**：接触器只画当前页面真实存在的主触点、线圈和反馈 PIN，不补画 A1/A2 或抑制器；功能区增加无导线占用的标题带，采用短标题和确定性文字碰撞审计。折叠控制台时同时隐藏复核详情、工程抽屉和页脚，1280×720 实测图纸窗高由 219px 提升到 535px；适页时图纸居中。CLI/Web 另提供 BOM、逐 PIN 接线表、RFQ 澄清表和审计证据四件套。
- **2.7.1 电气导线实线契约**：SVG 与 DXF 中全部真实电气连接统一为连续实线，控制和通信仍由颜色、图层、线宽及文字区分。新增 G050 / PAGE-Q13 阻断闸门，独立反读最终图元及继承线型；任何承载 `route/net/circuit` 的虚线都会禁止页面和项目交付。机械联动、光耦光路和辅助分区边界仍可使用虚线。

平台总架构、AI 权限、BOM 审批和领域扩展边界见 [SchematicForge 平台底座](docs/SCHEMATICFORGE-PLATFORM-ARCHITECTURE.md)。本轮三方取舍与可证明边界见 [2.7 三方源码复核集成](docs/EVSE-2.7-REFERENCE-INTEGRATION.md)。P0–P3、2.2–2.5 的历史基线分别见 [P0–P3 架构与安全边界](docs/P0-P3-ARCHITECTURE.md)、[P0–P3 验收报告](docs/P0-P3-VERIFICATION.md)、[控制导引与输出诊断验收](docs/FUNCTIONAL-SAFETY-VERIFICATION.md)、[216 矩阵验收报告](docs/P2-DRAWING-IR-VERIFICATION.md)、[用户项目图纸证据与在线编辑阶段报告](docs/USER-PROJECT-EVIDENCE-EDITOR.md)、[2.3 验收报告](docs/EVSE-2.3-VERIFICATION.md)、[Claude 参考集成说明](docs/CLAUDE-EDA-REFERENCE-INTEGRATION.md)、[2.4 验收报告](docs/EVSE-2.4-VERIFICATION.md) 与 [2.5 验收报告](docs/EVSE-2.5-VERIFICATION.md)。

## 快速生成

部署与根项目固定使用 Node.js 24.x；`component-workbench/` 仍保持 Node.js 20 以上兼容。

```powershell
node scripts\generate.js --params .\params.json --out .\output --name demo
```

最小参数：

```json
{
  "pileName": "120kW 双枪充电桩",
  "standard": "gb",
  "archetype": "dc-integrated",
  "outputKw": 120,
  "gunCount": 2,
  "gunCurrentA": 250,
  "moduleKw": 30,
  "voltageWindow": "200-1000",
  "thermal": "air",
  "essEnabled": false
}
```

成功后得到：

- `demo_EVSE-01.svg` … `demo_EVSE-06.svg`：S01–S06 六张稳定功能页，每页由自己的 Drawing IR 直接渲染；
- `demo_EVSE-01.dxf` … `demo_EVSE-06.dxf`：对应页面的 R2010 DXF，并携带 EDEM 端点及 Drawing IR 哈希；
- `demo_BOM.csv`：按物理设备去重的工程 BOM；
- `demo_WIRING.csv`：每条 circuit 的器件/PIN→器件/PIN 接线表；
- `demo_RFQ.csv`：型号、厂家、数据手册、认证与降额等待采购澄清字段；
- `demo_AUDIT.json`：EDEM 哈希、ERC、闭环检查、逐页 SVG/DXF 反读及项目闸门证据；
- `demo.json`：全项目诊断包，包含需求、选型、不可变 EDEM、六页清单、逐页闸门、跨页覆盖、工程 BOM 与项目总闸门。CLI 与 Web 使用同一多页编译链，不再调用旧单页绘图器。

字段契约见 [parameters.md](references/parameters.md)。接口支持 `GB/T、CCS2、CCS1、NACS、CHAdeMO`；桩型支持 `直流一体、直流分体、交直流一体、储能移动`。每个组合仍是方案级编译结果，不代表已经取得对应标准认证。

## Web

```powershell
npx serve web
```

此静态启动方式可以完整使用表单、本地规则需求解析、确定性选型、多页出图和对象编辑。发布仓库中的 `api/ai.js` 提供同源需求翻译代理；`api/engineering.js` 提供受限的上传审图和 BOM 资料候选代理。静态服务不运行服务端函数时，页面仍可本地生成，联网按钮会明确显示未配置而不会伪造结果。

完整本地部署可使用 `vercel dev`。需求翻译按需配置 `MOONSHOT_API_KEY`、`DEEPSEEK_API_KEY` 或 `ZHIPUAI_API_KEY`；工程审图、BOM 研究和知识巡检按需配置服务端 `OPENAI_API_KEY` 与 `OPENAI_ENGINEERING_MODEL`。所有浏览器发起的模型 POST 还必须配置不少于 32 字节的 `ENGINEERING_API_ACCESS_TOKEN`，并由站点管理员把访问令牌交给获准用户；页面只在当前内存保存该令牌。BOM 的人工批准签名需在可信 Node.js 边界配置不少于 32 字节的 `ENGINEERING_BOM_APPROVAL_SECRET`。浏览器端不保存模型 API Key，AI 不参与确定性选型、接线、坐标生成或工程批准。

Web 只加载自动生成的 `web/js/engine-bundle.js` 和交互层 `web/js/app.js`。修改任何 `engine/*.js` 后运行：

```powershell
npm run sync:web
```

不要手工修改 `web/js/` 中与 `engine/` 同名的核心副本。

## 测试

```powershell
npm run verify
```

`verify` 会先从 `engine/` 重建并校验 Web bundle，再执行全部单元、集成、安全、破坏变异和 216 组合矩阵测试。只运行矩阵或 P3 工作台测试可分别使用 `npm run test:matrix`、`npm run test:p3`。

主要覆盖：

- 既有 216 参数矩阵及五标准×四桩型代表组合的 ERC、SVG、Drawing IR、图模覆盖和导出闸门；
- 极性、电压域、PE、端点、审批状态与 coverage 破坏变异；
- CP 单源/同网、输出预检下游逐导体覆盖、接触器反馈、状态机防旁路与功能单元引用破坏变异；
- 路由 lane 容量、交叉、共线重叠、不同网接触和 keepout；
- SVG/DXF equipment/net/circuit/endpoint 追溯；
- 六页图册内部/跨页回路基数、连接器配对、远端引用、全局 PIN 身份及页级 DXF XDATA；
- AI 审图上传边界、BOM 八列契约、候选/批准哈希链、HTTPS/公网链接约束与只读知识巡检；
- RequirementSpec、CLI fail-closed、Web bundle 和单一源码同步；
- 多选、窗口/交叉框选、成组移动、网格微调、对齐/分布、单事务撤销与电气身份不变性；
- 元器件生命周期、证据、哈希修订链及恶意输入不执行。

## 元器件工作台

```powershell
node component-workbench\cli.js --help
npm test --prefix component-workbench
```

工作流与示例见 [component-workbench/README.md](component-workbench/README.md)。该工作台产生的是声明式候选与受控目录，不生成或安装可执行 skill/JavaScript；当前它与生产 `engine/` 隔离，导出的目录不会被引擎自动加载。

## 核心目录

```text
engine/                  唯一核心源码：需求、目录、EDEM、ERC、IR、渲染、DXF
scripts/                 CLI、核心加载顺序与 Web 同步
web/                     表单与生成的浏览器 bundle
tests/                   单元、集成、变异与 216 矩阵
component-workbench/     P3 器件资料导入与审批
docs/                    架构及验收报告
references/              参数、标准与参考边界说明
```
