# EVSE 充电连接器库（EVSE-CONNECTOR-LIB v1.1）

五类枪头的信号/电源触点定义库。`engine/connector-library.js` 提供受控物理触点，`engine/device-catalog.js` 把它们编译成端子，IEC 符号、线路和 DXF 均消费同一 Drawing IR；来源用于项目基线，不构成符合性证明。

| 类型 | 标准 | 触点（电源/信号/辅助） | 通信 |
|---|---|---|---|
| gbt-dc | 国标 GB/T 20234.3 | DC±、PE、S±（CAN）、CC1/CC2（连接确认/锁判据）、A±（辅助供电） | GB/T 27930 CAN 250kbps |
| ccs2 | 欧标 IEC 62196-3 FF | DC±、PE（顶中）、CP（控制导引/PLC）、PP（接近检测，PE-PP 1500Ω）；L1-L3/N 空触头 | DIN 70121 / ISO 15118 PLC |
| ccs1 | 美标 IEC 62196-3 EE | 同 CCS2，上盘 Type1（L1/L2/N） | DIN 70121 / ISO 15118 / J2847-2 |
| nacs | 美标 SAE J3400 | 5 触点复用：DC+/L1、DC-/L2/N、PE、CP、PP；V2G/V2H/V2L | ISO 15118 PLC / PWM-CP(J1772)/LIN-CP |
| chademo | 日标 CHAdeMO | 10个独立触点：DC±、FG/PE、Charger 12V、连接检查、启停1/2、充电使能、CAN_H/CAN_L | CHAdeMO CAN（车辆主导；项目锁定版本） |

## 画法约定

- 主功率 DC± 统一布置在枪心 ±18，与快熔/接触器列对齐直连
- PE：顶部触头经引出线右行并入 PE 干线，横跨 DC± 立线处走半圆（LIB-R10）
- 信号触头各画虚线支线接本触头，跨控制总线为 T 接；标签错行防重叠
- 引出线横跨电源立线处自动加半圆（符号库内处理）
- 信号去向在端子网表中明确：CCS/NACS 的 CP/PP、GB 的 CC1/CC2 与 S±、CHAdeMO 的连接检查/启停1/2/充电使能/CAN-H/CAN-L 均为不同物理端子；CHAdeMO Charger 12V 还是独立辅助电源域。任何标准都不得靠编辑距离或名称相似度自动接线。
- NACS 的站点交流进线与车辆连接器输出分开：直流快充柜可使用 480V 三相站点进线，J3400 车辆侧交流输出则通过两个大电流触点提供单相 L1/L2；不能把站点进线误画为“两相”。
- CHAdeMO 2.1 公布了最高 800A 能力，但当前受控选择器只开放至 500A；在 800A 枪线、冷却、触点温升与厂家配置未进入批准目录前，平台不得把最高协议能力冒充项目可用额定值。

## 平台支持

`ev-standards.js` 五个标准条目（gb/eu/us/nacs/chademo）均带 `connectorType` 指向本库；表单可选五类标准一键出图。
