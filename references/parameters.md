# 输入参数契约（generate.js --params）

JSON 对象，全部字段可选；缺省值见下表。Agent 的职责是**把用户自然语言翻译成该 JSON**，不做任何工程决策（选型、档位、保护策略由引擎确定性计算）。

## 字段表

| 字段 | 类型 | 枚举 / 范围 | 缺省 | 说明 |
|---|---|---|---|---|
| pileName | string | ≤40 字 | 充电桩 | 桩名，用于标题栏与文件名 |
| site | string | 自由文本 | 空 | 站点 / 项目名 |
| standard | string | `gb` 国标 GB/T / `eu` 欧标 CCS2 / `us` 美标 CCS1 / `nacs` SAE J3400 / `chademo` 日标 | gb | 五种接口均使用独立受控物理端子模板，未知值 fail-closed |
| archetype | string | `dc-integrated` / `dc-split` / `ac-dc-combo` / `ess-mobile` | dc-integrated | 直流一体、直流分体、AC+DC 一体、储能移动四种独立拓扑 |
| outputKw | number | ≥20，步长 10 | 120 | 额定输出功率 kW |
| moduleKw | number | 15 / 20 / 30 / 40 / 60 | 40 | 单功率模块 kW（60 为液冷） |
| gunCount | number | 1–4 | 2 | 充电枪数 |
| gunCurrentA | number | 125 / 200 / 250（风冷）300 / 400 / 500（液冷） | 250 | 单枪电流；500 A 必须复核连接器型式和温升试验 |
| voltageWindow | string | `200-750` / `150-1000` / `200-1000` / `500-1000` | 200-1000 | 输出电压窗口（500-1000 为高压平台车型） |
| acVoltage | number | 380 / 400 / 480 | 按标准（gb=380；eu/chademo=400；us/nacs=480） | **站点进线**线电压；NACS 车辆侧单相 L1/L2 与站点三相进线分开 |
| supplyMode | string | `grid` 市电直供 / `transformer` 专变 / `offgrid` 离网为主 | transformer | 供电方式 |
| essEnabled | bool | true / false | false | 是否配置储能；`ess-mobile` 必须为 true，否则需求闸门阻断 |
| essKwh | number | ≥20 | 200 | 储能目标容量 kWh |
| essPowerKw | number | ≥10 | 120 | 储能变换功率 kW |
| essChem | string | `lfp` 磷酸铁锂 / `nmc` 三元 | lfp | 电池化学体系 |
| essCoupling | string | `dc` 直流侧 DC/DC / `ac` 交流侧 PCS | dc | 储能耦合方式 |
| thermal | string | `air` 风冷 / `liquid` 液冷 | liquid | 热管理 |
| ipRating | string | IP54 / IP55 / IP65 | IP54 | 防护等级 |
| ambient | string | 自由文本 | 空 | 环境描述（如"沿海高盐雾""-30℃ 低温"） |
| backend | string | `ocpp16` / `ocpp201` / `private` | ocpp16 | 后台协议 |
| hmiSize | string | 7 英寸 / 10 英寸 / 15 英寸 | 10 英寸 | 显示屏 |
| hmiPayment | string | 扫码 / 刷卡 / 扫码 + 刷卡 / 刷卡 + 即插即充 | 扫码 / 刷卡 | 支付方式 |
| moduleEfficiency | number | 0.85–0.99 | 0.95 | 模块效率（假设） |
| inputPf | number | 0.8–1 | 0.99 | 功率因数（假设） |
| lowTemp | bool | true / false | false | 配置加热 / 除湿回路 |
| pref | string | `balance` 均衡 / `cost` 成本优先 / `reliability` 可靠性优先 | balance | 选型偏好 |
| specialRequirements | string[] | ≤20 条 | [] | 保留的专项要求（原文保留，不工程化） |
| designer | string | ≤120 字符 | Jixiong Lu | 标题栏"设计人"署名 |
| watermarkText | string | ≤12 字符 | 卢继雄 | 图面斜置半透明水印文字；空字符串则不加水印 |
| requirementSource | string | `FORM` / `CLI` / `LOCAL_RULES` / `SERVER_AI:<provider>` | FORM（CLI 为 CLI） | 参数来源标记 |
| requirementConfidence | number/null | 0–1 | null | 自动需求翻译置信度 |
| unresolvedItems | string[] | ≤20 条 | [] | 待用户确认的问题 / 未决项 |
| requirementConfirmed | bool | true / false | false | 用户已明确复核低置信度翻译和未决项 |
| requirement | object | `EVSE-REQUIREMENT/1.0` | 自动生成 | 规范化的来源、置信度、假设、问题与未决项 |

## 自然语言翻译规则（Agent 用）

1. 只提取用户**明确说出**的参数；没说的一律用缺省值，并在回复中列出"采用缺省/假设"的字段。
2. 关键词映射示例：`国标/GB` → gb；`欧标/CCS2/欧洲` → eu；`美标/CCS1/美国` → us；`NACS/J3400` → nacs；`CHAdeMO` → chademo；`液冷` → thermal=liquid；`风冷` → air；`储能/削峰/电池容量 xxx 度` → essEnabled=true + essKwh；`无储能/不带储能` 必须优先解析为 essEnabled=false；`PCS/交流侧` → essCoupling=ac；`DC/DC 或直流侧` → dc。
3. 识别不到的环境/特殊要求（沿海、高寒、防爆、一机多充等）原文写入 `specialRequirements`，**不要**自己推导工程措施。
4. 数值冲突或非法枚举不得静默取近似值；需求闸门会阻止生成并要求修正。选择 `ess-mobile` 时必须显式启用储能，Web 会同步切换为离网为主的补能模式。
5. 自动翻译置信度低于 0.75、缺失置信度或存在 questions/unresolvedItems 时，Web 必须勾选复核确认后再次生成；CLI 必须设置 `requirementConfirmed=true` 或显式传入 `--confirm-requirements`。

## 输出文件

| 文件 | 内容 | 边界 |
|---|---|---|
| `<name>.svg` | 自动选择 A3/A2/A1/A0（超出 A0 时使用受控自定义幅面）的端子级原理图；每条 route 保存 equipment/net/circuit/exact endpoint 标识 | 概念草图，专业复核必需 |
| `<name>.dxf` | 与 SVG 共用 Drawing IR 的 R2010 DXF，语义标识保存为 `EVSE_IR` XDATA | 非 DWG 替代、无尺寸/保护整定 |
| `<name>.json` | EVSE-SOLUTION-PACKAGE/1.0：RequirementSpec、EDEM v4、BOM、ERC、图模覆盖和导出闸门 | 厂家器件仍需受控审批/RFQ |

导出闸门：`EVSE_DRAWING_SKILL.canExport` 不通过时脚本退出码 2 且不写 SVG/DXF（fail-closed），只写 JSON 报告。显式非法数字、布尔值、枚举或未实现组合不得静默回退默认值。
