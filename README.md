# EVSE Schematic Design 2.0

这是一个方案级充电桩电气设计编译器。输入经过需求确认后，被编译为 EDEM v4 端子级网表；SVG 和 DXF 都从同一 Drawing IR 生成，并由 ERC、几何与图模覆盖闸门 fail-closed。

> 输出仅用于方案比较与工程深化输入，须经电气专业复核和签发；不构成生产图、施工图或合规证明。

## 本次 P0–P3 改造

- **P0 — 输入与运行时**：Web/CLI 共用 `RequirementSpec`；修复“无储能”、标准电压联动和标准识别；低置信度/未决项要求人工确认；未实现标准与桩型明确阻断；`engine/` 成为唯一核心源码。
- **P1 — 电气真值**：EDEM v4 明确建模 L1/L2/L3/N、DC+/DC−、PE、24V/0V、12V/0V、枪针脚、接触器线圈和储能原子保护器件；新增受控设备类目录与端子级 ERC。
- **P2 — 几何与导出**：确定性 placement、通道与区间图 lane 分配、正交路由、全局交叉后处理、keepout、Drawing IR 和 exact coverage；SVG/DXF 同源且保留可追溯 ID。
- **P3 — 器件导入**：安全的资料草稿、证据、审核、批准、废弃和受控 JSON 导出工作台；上传内容永不作为代码执行。

详细架构见 [P0–P3 架构与安全边界](docs/P0-P3-ARCHITECTURE.md)，完整交付结果见 [P0–P3 最终验收报告](docs/P0-P3-VERIFICATION.md)，P2 几何专项见 [216 矩阵验收报告](docs/P2-DRAWING-IR-VERIFICATION.md)。

## 快速生成

需要 Node.js 24.x。Vercel 与根项目固定使用当前受支持的 Node.js 24 主版本；`component-workbench/` 仍保持 Node.js 20 以上兼容。

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

- `demo.svg`：A3 方案级端子原理图；
- `demo.dxf`：直接由 Drawing IR 生成的 R2010 DXF；
- `demo.json`：需求、选型、EDEM、ERC、图模审计和导出闸门的完整方案包。

字段契约见 [parameters.md](references/parameters.md)。当前只开放经过矩阵验证的 `GB/EU/US + dc-integrated`；NACS、CHAdeMO 和其他桩型会明确 fail-closed。

## Web

```powershell
npx serve web
```

此静态启动方式可以完整使用表单、本地规则需求解析、确定性选型和出图。Kimi、DeepSeek、GLM 等远程需求翻译由仓库中的同源 `/api/ai` 服务端代理提供；静态服务不运行该函数时页面会安全回退到本地规则解析。

Web 只加载自动生成的 `web/js/engine-bundle.js` 和交互层 `web/js/app.js`。修改任何 `engine/*.js` 后运行：

```powershell
npm run sync:web
```

不要手工修改 `web/js/` 中与 `engine/` 同名的核心副本。

仓库保留同源服务端代理 `api/ai.js`。完整本地部署可使用 `vercel dev`；Vercel 环境变量按需配置 `MOONSHOT_API_KEY`、`DEEPSEEK_API_KEY` 或 `ZHIPUAI_API_KEY`，浏览器端不保存 API Key。仅执行 `npm start` 时使用静态表单、本地规则解析和确定性出图，远程 AI 不可用会安全回退。

## 测试

```powershell
npm run verify
```

`verify` 会先从 `engine/` 重建并校验 Web bundle，再执行全部单元、集成、安全、破坏变异和 216 组合矩阵测试。只运行矩阵或 P3 工作台测试可分别使用 `npm run test:matrix`、`npm run test:p3`。

主要覆盖：

- 216 个已支持参数组合的 ERC、SVG、Drawing IR、图模覆盖和导出闸门；
- 极性、电压域、PE、端点、审批状态与 coverage 破坏变异；
- 路由 lane 容量、交叉、共线重叠、不同网接触和 keepout；
- SVG/DXF equipment/net/circuit/endpoint 追溯；
- RequirementSpec、CLI fail-closed、Web bundle 和单一源码同步；
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
