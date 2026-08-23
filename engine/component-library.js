/* ============================================================
 * EVSE 关键元器件库 v1.0 —— 专用组件/约束知识库
 * ------------------------------------------------------------
 * 提取来源（四源交叉）：
 *   SRC-GB-PDF  国标充电桩电气原理图.pdf（储能桩系统图：电池箱×4、H100D 绝缘检测仪、
 *               BMS 主机 C10F、充电模块 M1~M3、开关电源 4500W-24V / 320W-12V、QF、
 *               K1~K8 接触器组、国标充电枪、直流/交流补电座、风扇、急停开关组）
 *   SRC-EU-PDF  欧标充电桩电气原理图.pdf（储能充电桩：150A 欧标补电座、22KW PCS、
 *               30KW DC/DC M1~M2、BCU/EVCC/SECC、K1~K10 200A-24V、预充 K3 50A-24V
 *               + 200W-30R、开关电源 4500W-24V / 360W-12V、RS1/RS2、FU1~FU3、
 *               浪涌 3P+N、漏电继电器、KM1/KM2、电子锁及反馈、PE 接地端子、急停开关组）
 *   SRC-GB-SVG  sch_lib/国标60kW充电桩电气原理图.svg
 *   SRC-EU-SVG  sch_lib/欧标充电桩电气原理图.svg
 *
 * 定位：本库是"画法规则与必备组件清单"，不是报价目录、不是标准符合性证明。
 * mandatory=true 的组件在一键生成时由 drawing-skill 渲染闸门强制检查（fail-closed）。
 * ============================================================ */
window.EVSE_COMPONENT_LIB = (function () {
  'use strict';

  const ID = 'EVSE-COMPONENT-LIB';
  const VERSION = '1.0.0';

  const SOURCES = Object.freeze([
    { id: 'SRC-GB-PDF', file: '国标充电桩电气原理图.pdf', type: 'reference-schematic', reviewed: true },
    { id: 'SRC-EU-PDF', file: '欧标充电桩电气原理图.pdf', type: 'reference-schematic', reviewed: true },
    { id: 'SRC-GB-SVG', file: 'sch_lib/国标60kW充电桩电气原理图.svg', type: 'reference-schematic', reviewed: true },
    { id: 'SRC-EU-SVG', file: 'sch_lib/欧标充电桩电气原理图.svg', type: 'reference-schematic', reviewed: true }
  ]);

  /* zone 与原理图分区对应；mandatory 组件缺失时渲染闸门阻断导出 */
  const COMPONENTS = Object.freeze([
    { id: 'CMP-QS', tag: 'QS', name: '进线隔离开关', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-GB-SVG', 'SRC-EU-SVG'], note: '检修隔离断点，与断路器配合' },
    { id: 'CMP-QF', tag: 'QF', name: '进线断路器', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: 'PDF 实证含 MX+OF 附件；档位待短路计算书' },
    { id: 'CMP-SPD', tag: 'FV', name: '电涌保护器', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '欧标 PDF 浪涌 3P+N' },
    { id: 'CMP-RCM', tag: 'RCM', name: '剩余电流监测/漏电继电器', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '含直流分量检测，动作值待接地型式确认' },
    { id: 'CMP-AC-METER', tag: 'PJ', name: '交流电能表', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-GB-SVG', 'SRC-EU-SVG', 'SRC-EU-PDF'], note: '计量检定按当地主管部门' },
    { id: 'CMP-KM', tag: 'KM', name: '交流主接触器', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-EU-PDF', 'SRC-GB-PDF', 'SRC-GB-SVG'], note: '欧标 PDF KM1/KM2（NCH8-40/11 类）' },
    { id: 'CMP-AC-BUS', tag: 'WB', name: '交流分配母排', zone: '交流进线与保护', net: 'POWER_AC', mandatory: true, evidence: ['SRC-GB-SVG', 'SRC-EU-SVG'], note: '' },
    { id: 'CMP-MODULE', tag: 'M', name: 'AC/DC 功率模块/充电模块', zone: '功率变换', net: 'POWER_DC', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '国标 PDF M1~M3；欧标 PDF 30KW DC/DC M1~M2、22KW PCS' },
    { id: 'CMP-FU-MAIN', tag: 'FU', name: '直流总快熔', zone: '直流保护与计量', net: 'POWER_DC', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: 'FU1~FU3 gR/aR' },
    { id: 'CMP-TA', tag: 'TA/RS', name: '直流电流传感器/分流器', zone: '直流保护与计量', net: 'POWER_DC', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG'], note: '国标 PDF HAH1BVW 霍尔；欧标 PDF RS1/RS2' },
    { id: 'CMP-DC-METER', tag: 'PJ2', name: '直流电能表', zone: '直流保护与计量', net: 'POWER_DC', mandatory: true, evidence: ['SRC-GB-SVG', 'SRC-EU-SVG', 'SRC-EU-PDF'], note: '欧标 PDF 直流电表 DV+' },
    { id: 'CMP-IMD', tag: 'RI/IMD', name: '绝缘监测装置', zone: '直流保护与计量', net: 'POWER_DC', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '国标 PDF H100D 绝缘检测仪；判据按 GB/T 18487.1 项目确认' },
    { id: 'CMP-DISCHARGE', tag: 'RS0', name: '母线泄放电阻', zone: '直流保护与计量', net: 'POWER_DC', mandatory: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG'], note: '停机泄放至安全电压，阻值待电容量核算' },
    { id: 'CMP-GUN-FUSE', tag: 'F{n}', name: '枪回路直流快熔（每枪独立）', zone: '充电枪回路', net: 'POWER_DC', mandatory: true, perGun: true, evidence: ['SRC-GB-SVG', 'SRC-EU-SVG', 'SRC-EU-PDF'], note: '' },
    { id: 'CMP-GUN-CONTACTOR', tag: 'K{n}P/K{n}N', name: '正/负极直流接触器（每枪独立）', zone: '充电枪回路', net: 'POWER_DC', mandatory: true, perGun: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '欧标 PDF K7/K8、K9/K10 200A-24V 类' },
    { id: 'CMP-GUN-LOCK', tag: 'YV{n}', name: '电子锁及锁到位反馈（每枪）', zone: '充电枪回路', net: 'SIGNAL_CTRL', mandatory: true, perGun: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '充电中禁止解锁' },
    { id: 'CMP-GUN', tag: 'XS{n}', name: '充电连接器', zone: '充电枪回路', net: 'POWER_DC', mandatory: true, perGun: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '国标 9 芯 / 欧标 CCS2（DC±/PE/CP/PP）150A 欧标直流充电枪' },
    { id: 'CMP-ESS-CLUSTER', tag: 'BAT', name: '电池簇/电池箱（温感+加热）', zone: '储能系统', net: 'POWER_ESS', mandatory: 'ess', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'], note: 'PDF 实证电池箱 1~4，通信进/出、加热接口、温感' },
    { id: 'CMP-ESS-FUSE', tag: 'FU-ESS', name: '电池簇熔断器', zone: '储能系统', net: 'POWER_ESS', mandatory: 'ess', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '' },
    { id: 'CMP-ESS-CONTACTOR', tag: 'K-Main', name: '簇主正/主负接触器', zone: '储能系统', net: 'POWER_ESS', mandatory: 'ess', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'], note: 'PDF 实证总正/总负继电器、K1/K2 200A-24V' },
    { id: 'CMP-ESS-PRECHARGE', tag: 'K-Pre+R', name: '预充单元（预充接触器+预充电阻）', zone: '储能系统', net: 'POWER_ESS', mandatory: 'ess', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '欧标 PDF 预充 K3 50A-24V + 200W-30R' },
    { id: 'CMP-BMS', tag: 'BAMS', name: '电池管理 BMS/BCU', zone: '储能系统', net: 'SIGNAL_COMM', mandatory: 'ess', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'], note: 'BMS 主机 C10F / BCU' },
    { id: 'CMP-ESS-CONVERTER', tag: 'PCS/DC-DC', name: '储能变换器（DC/DC 或 PCS）', zone: '储能系统', net: 'POWER_ESS', mandatory: 'ess', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '22KW PCS / 30KW DC/DC 类' },
    { id: 'CMP-ESS-GRID', tag: 'QF2/KM2/KC1/FC1', name: '变换器并网保护（AC 断路器+接触器 / DC 接触器+快熔）', zone: '储能系统', net: 'POWER_AC', mandatory: 'ess', evidence: ['SRC-EU-PDF'], note: '欧标 PDF 实证：PCS 侧 KM1/K9/K10/FU3；DC/DC 侧 K7/K8/FU2' },
    { id: 'CMP-CCU', tag: 'A1', name: '充电控制单元 CCU/主板', zone: '二次控制与通信', net: 'SIGNAL_CTRL', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '充电桩主板一/主板控制' },
    { id: 'CMP-SECC', tag: 'A2', name: 'SECC/计费通信网关', zone: '二次控制与通信', net: 'SIGNAL_COMM', mandatory: true, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: 'EVCC/SECC、OCPP' },
    { id: 'CMP-ROUTER', tag: 'A3', name: '路由器/天线/GPS', zone: '二次控制与通信', net: 'SIGNAL_COMM', mandatory: false, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG'], note: '三合一天线、GPS、VBOX' },
    { id: 'CMP-HMI', tag: 'A4', name: '显示与人机交互', zone: '二次控制与通信', net: 'SIGNAL_CTRL', mandatory: false, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG'], note: '4.3 寸显示屏、按钮开关、启停按钮' },
    { id: 'CMP-ESTOP', tag: 'SB', name: '急停按钮', zone: '安全', net: 'SIGNAL_CTRL', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '急停开关组/AQSF，双断点硬线切除输出使能' },
    { id: 'CMP-DOOR', tag: 'SQ', name: '门禁/防拆开关', zone: '安全', net: 'SIGNAL_CTRL', mandatory: false, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG'], note: '' },
    { id: 'CMP-LAMP', tag: 'HL', name: '状态指示灯', zone: '安全', net: 'SIGNAL_CTRL', mandatory: false, evidence: ['SRC-EU-PDF', 'SRC-GB-SVG'], note: '' },
    { id: 'CMP-PSU-24', tag: 'T1', name: '开关电源 24V', zone: '辅助电源与配电', net: 'POWER_AUX', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '4500W-24V / 300W 24V 类' },
    { id: 'CMP-PSU-12', tag: 'T2', name: '开关电源 12V', zone: '辅助电源与配电', net: 'POWER_AUX', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '320W-12V / 360W-12V / 300W-12V 类' },
    { id: 'CMP-THERMAL', tag: 'M2', name: '热管理（风扇/液冷机组）', zone: '辅助电源与配电', net: 'POWER_AUX', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '风扇实证于两 PDF' },
    { id: 'CMP-PE', tag: 'PE', name: '保护接地排/接地端子', zone: '保护接地', net: 'PROTECTIVE_EARTH', mandatory: true, evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'], note: '接地端子 GJB/PTN；枪与柜体接 PE' }
  ]);

  /* 约束条件：drawing-skill 渲染闸门按 LIB-Rxx 做阻断式检查 */
  const CONSTRAINTS = Object.freeze([
    { id: 'LIB-R01', enforcement: 'BLOCKING', text: '直流母线必须配置绝缘监测与电流采样并送至控制单元。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R02', enforcement: 'BLOCKING', text: '每把充电枪必须独立配置快熔、正/负极直流接触器、电子锁及锁到位反馈。', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R03', enforcement: 'BLOCKING', text: '储能电池簇必须经过熔断、主正/主负接触器与预充单元才能并入储能母线。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R04', enforcement: 'BLOCKING', text: '辅助电源必须同时具备 24V 与 12V 两档开关电源。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R05', enforcement: 'BLOCKING', text: '图面必须包含急停节点，急停硬线切除输出使能。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R06', enforcement: 'BLOCKING', text: '交流进线必须具备隔离、断路、浪涌保护与剩余电流监测节点。', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R07', enforcement: 'BLOCKING', text: '保护接地边界必须明确：充电枪 PE、柜体与接地排连通，PE 不得只依靠颜色表达。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R08', enforcement: 'BLOCKING', text: '图面必须包含热管理节点（风扇/液冷），温升与风量待热工计算。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R09', enforcement: 'BLOCKING', text: '储能变换器并网侧必须经隔离与分断器件（交流：断路器+并网接触器；直流：并网接触器+快熔），禁止无保护直接并入母线。', evidence: ['SRC-EU-PDF'] },
    { id: 'LIB-R10', enforcement: 'BLOCKING', text: '任何电源/信号走线正交交叉，必须其中一条走线以半圆跨越（禁止直线穿通）；T 型连接点除外。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R11', enforcement: 'BLOCKING', text: '交流分配母排必须按相分线绘制：三相为 L1/L2/L3（带中性线时加 N），禁止三相合一单线表示。', evidence: ['SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R12', enforcement: 'BLOCKING', text: '充电枪控制导引信号必须画出并明确连接去向：CCS2/CCS1 的 CP→SECC（PLC/ISO 15118）、PP→CCU；GB 的 CC1/CC2→CCU、S+/S- CAN→CCU。', evidence: ['SRC-EU-PDF', 'SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R13', enforcement: 'BLOCKING', text: '设备明细表必须遍历原理图全部设备位号并列入（含泄放电阻、指示灯、门禁、母排、预充回路等），缺项即阻断。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] },
    { id: 'LIB-R14', enforcement: 'BLOCKING', text: '图上颜色必须出自 EVSE-COLOR-SCHEME（IEC 60446 识别色 + 项目约定白名单），未登记颜色即阻断。', evidence: ['SRC-GB-SVG', 'SRC-EU-SVG'] },
    { id: 'LIB-R15', enforcement: 'BLOCKING', text: '信号不用共享总线：每根信号线单独从一个设备接到另一个设备（点对点），电源母排除外。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] },
    { id: 'LIB-R16', enforcement: 'BLOCKING', text: '每个设备必须明确供电电压与取电来源（明细表+图上馈线标注），缺项即阻断。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] },
    { id: 'LIB-R17', enforcement: 'BLOCKING', text: '每根信号线必须从设备A单独接到设备B；任何两根信号线不得同向共线重合（含共用立线/汇入同一走线）。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] },
    { id: 'LIB-R18', enforcement: 'BLOCKING', text: '信号线必须走实线（禁止虚线）；设备上方为禁走线区，所有信号线必须避让设备。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] },
    { id: 'LIB-R19', enforcement: 'BLOCKING', text: '平行信号线必须上下/左右错开≥6px（走线层/通道间距），禁止并合；交叉处走半圆。', evidence: ['SRC-GB-PDF', 'SRC-EU-PDF'] }
  ]);

  return { ID, VERSION, SOURCES, COMPONENTS, CONSTRAINTS };
})();
