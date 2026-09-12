# EVSE 2.7 三方源码复核与集成说明

复核对象：

- GPT6 `evse-schematic-design-2.6.0.zip`，SHA-256 `D643F1805EF401C92E56DBA347F78F86FA0472DB5A1A7D758AB308F5FCC06B50`；
- Qwen3.8 `3.4.2.zip`，SHA-256 `E57E607C51709C90134ECD8494831505ECCD0381002695D7534FDA005B6CF7E6`；
- `EVSE-2.6-三方源码复核报告.md`，SHA-256 `EC9350EBFA86329164920911CE565D3661FA845247560DAE25220BA5405492A1`。

本轮不是把某一份参考代码整包覆盖到当前底座。取舍标准只有三个：电气真值是否唯一、最终交付物是否可独立互证、失败时是否闭锁且不猜测。

## 采纳并加强的部分

| 参考启发 | 2.7 的实现 |
|---|---|
| Qwen LOOP-001～006 强调正负回流、线圈 COM 与 PE | `loop-integrity.js` 沿实际 circuits 搜索，正负端必须归属于同一物理电源及输出对；工作 0V 不自动并入 PE。ERC-086 汇总执行，证据不足保持 `NOT_EVALUATED`。 |
| GPT6 报告复现“删掉最终 SVG 线仍通过” | `rendered-svg-audit.js` 使用受限 XML 读取器独立核对最终可见段、跨线圆弧、端子、符号图元、文字、选择命中层、跨页身份及页面骨架；G049 和 PAGE-Q10 在导出当刻重新运行。 |
| 报告提出 DXF 仍缺独立反读 | `rendered-dxf-audit.js` 不信任导出器 manifest，重新解析 DXF `ENTITIES` 和 `EVSE_IR` XDATA，逐图元核对类型、图层、坐标及全局/图形端点身份。CLI 和 Web 均在下载前执行。 |
| Claude/Qwen 的接触器表达更接近工程习惯 | 接触器符号按实际存在的主触点、线圈、反馈端子分别实例化；单个反馈输出画成 FB 接口，不伪造双端干接点，也不默认补二极管/TVS/RC。 |
| Qwen 的功能聚类和紧凑标题更易读 | placement 按主功率、储能补电、辅助、送电诊断、控制通信、PE 分区；每区预留不参与导线 lane 的标题带，标题采用短名称，完整流向保留在结构化 description/flow 元数据。 |
| 报告提出文字碰撞仍需覆盖 | `visual-quality-audit.js` 在渲染前以确定性保守字宽检查不同所有者文字重叠、文字穿入其他器件、导线压字和标题 clearance。它只产生 REVIEW，不以近似字体度量冒充几何真值。 |
| 参考平台的采购资料组织更产品化 | `engineering-delivery.js` 从同一 EDEM 生成 BOM、逐 PIN 接线、RFQ 和审计 JSON；CSV 防公式注入。厂家、型号和 URL 为空或未核验时保持询价状态，AI 检索只能产生候选。 |
| 报告建议缩小图面 UI 干扰 | 参数、库和 PIN 属性在图纸上方；总控制台收起时同时收起复核详情、工程抽屉、状态条和页脚。1280×720 浏览器实测图纸窗由 219px 增至 535px，并支持适宽、适页、锚点缩放、平移和全屏。 |

## 明确没有照搬的部分

- 不采用 DOM 或绘制登记表作为第二电气真值。编辑仍只提交 Drawing IR 几何事务，网络身份来自不可变 EDEM。
- 不按颜色推断电压域、网络或极性；不使用编辑距离、LLM 或“看起来相近”补接 PIN。
- 不在浏览器 `localStorage` 保存模型 API Key，不让 AI 候选直接进入主 BOM、标准库或接线规则。
- 不采用渲染后的 `label-fix.js` 改坐标；文字位置在 placement 阶段确定，并接受同一页的质量闸门。
- 不采用主观总分掩盖阻断缺陷。电气、覆盖、几何及最终文件互证是 BLOCKING；视觉近似和超标准图幅是 REVIEW。
- 不把 GPT6 的另一套页集编译器覆盖到现有六页投影。现有实现已证明内部回路一次、跨页回路两次、连接器成对及全局 PIN 身份；替换会重新引入两套分页事实。
- 不自动假设厂家实际 PIN、接触器抑制器、预检阈值、短路容量或保护整定值。

## 新增可证明链路

```text
RequirementSpec
  → immutable EDEM v4.1
  → ERC + LOOP-001…006
  → exact six-page projection + paired xref
  → Drawing IR geometry re-analysis
  → SVG renderer → independent final-SVG readback
  → DXF renderer → independent ENTITIES/XDATA readback
  → BOM / PIN wiring / RFQ / audit evidence
```

任一 BLOCKING 项会阻止导出；旧哈希、旧 PASS、不可见图元、覆盖层、删线、移线或错误 XDATA 都不能单独绕过闸门。

## 浏览器实测

在本地静态站点和 1280×720 浏览器中完成：

- 默认国标六页全部 PASS，页面 51/51 回路及 21/21 跨页续接符精确覆盖；
- 拖动 `EQ-AC-BUS` 后 12 条关联线路自动重布，页面保持 PASS；非法重叠被拒绝并回滚；
- Undo/Redo 的 Drawing IR 哈希严格往返，切换 S01/S02 后 S01 编辑仍保留；
- 欧标四枪分体式、NACS 交直流一体式、CHAdeMO 移动储能均生成六页，无通用符号 fallback；
- NACS 与 CHAdeMO 代表配置六页均 PASS；欧标四枪 S03 因内容超过 A0 明确为 `REVIEW_REQUIRED`，不是静默缩小文字或错误放行；
- 浏览器控制台无错误，AI 数据手册检索在没有受控访问令牌时保持禁用。

## 仍然不能宣称的能力

1. 功率模块阵列仍是带数量的汇总物理实例，尚未展开每个模块、端子排、线号、电缆号和逐模块 PE。
2. 移动储能模板中缺厂家 COM/PIN 资料的回流项保持 `NOT_EVALUATED`；不能据此签发生产图。
3. 当前编辑器支持器件、导线形状、文字和图示的事务编辑，但新增/删除器件或网络必须先实现 EDEM 拓扑事务。
4. 文字审计覆盖 Drawing IR 内器件文字与注释，不是浏览器/CAD 字体整形认证，也尚未覆盖图签、设备表和图例所有文字的真实字体碰撞。
5. 极密四枪页面可能超过 A0 并进入 REVIEW；后续应在保持精确跨页 PIN 合同的前提下按枪/控制单元继续分页，不能靠减小字体规避。
6. 短路、保护选择性、热、绝缘、EMC、接地、计量、消防、并网、接口一致性试验与工程师签发仍是项目工作。

本版本提高的是可追溯性、失败闭锁、文件互证、交付完整性和实际操作空间，不构成标准认证或“已经可直接施工”的结论。
