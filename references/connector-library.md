# EVSE 充电连接器库（EVSE-CONNECTOR-LIB v1.0）

五类枪头的信号/电源触点定义库，**数据驱动**绘制枪头符号与外部接线（`js/connector-library.js`，符号/接线共用同一套端子坐标，保证"画在哪、接在哪"）。来源：联网查阅 + 标准文本。

| 类型 | 标准 | 触点（电源/信号/辅助） | 通信 |
|---|---|---|---|
| gbt-dc | 国标 GB/T 20234.3 | DC±、PE、S±（CAN）、CC1/CC2（连接确认/锁判据）、A±（辅助供电） | GB/T 27930 CAN 250kbps |
| ccs2 | 欧标 IEC 62196-3 FF | DC±、PE（顶中）、CP（控制导引/PLC）、PP（接近检测，PE-PP 1500Ω）；L1-L3/N 空触头 | DIN 70121 / ISO 15118 PLC |
| ccs1 | 美标 IEC 62196-3 EE | 同 CCS2，上盘 Type1（L1/L2/N） | DIN 70121 / ISO 15118 / J2847-2 |
| nacs | 美标 SAE J3400 | 5 触点复用：DC+/L1、DC-/L2/N、PE、CP、PP；V2G/V2H/V2L | ISO 15118 PLC / PWM-CP(J1772)/LIN-CP |
| chademo | 日标 CHAdeMO | DC±、PE、CP（连接确认）、CAN_H/CAN_L（通信）、d1/d2（启停使能） | CHAdeMO CAN（车辆主导） |

## 画法约定

- 主功率 DC± 统一布置在枪心 ±18，与快熔/接触器列对齐直连
- PE：顶部触头经引出线右行并入 PE 干线，横跨 DC± 立线处走半圆（LIB-R10）
- 信号触头各画虚线支线接本触头，跨控制总线为 T 接；标签错行防重叠
- 引出线横跨电源立线处自动加半圆（符号库内处理）
- 信号去向在控制总线注释中明确：CCS/NACS：CP→A2 SECC、PP→A1 CCU；GB：CC1/CC2→A1、S±→A1/A2；CHAdeMO：CP→A1、CAN→A1 CCU（LIB-R12 / G040 强制自检）

## 平台支持

`ev-standards.js` 五个标准条目（gb/eu/us/nacs/chademo）均带 `connectorType` 指向本库；表单可选五类标准一键出图。
