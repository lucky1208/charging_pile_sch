/* ============================================================
 * EVSE 充电连接器库 v1.0 —— 五类枪头信号/电源触点定义（数据驱动符号）
 * ------------------------------------------------------------
 * 来源（联网查阅 + 标准文本）：
 *   gbt-dc    GB/T 20234.3 直流 9 芯：DC±/PE/S±/CC1/CC2/A±，GB/T 27930 CAN
 *   ccs2      IEC 62196-3 FF：上盘 Type2（PE 顶中、PP/CP 小针、L1-L3/N），下 DC±；
 *             CP=控制导引（PLC ISO 15118/DIN 70121），PP=接近检测（PE-PP 1500Ω）
 *   ccs1      IEC 62196-3 EE：上盘 Type1（PE/PP/CP、L1/L2/N），下 DC±
 *   nacs      SAE J3400（原特斯拉 NACS）5 触点：DC+/L1、DC-/L2/N、PE、CP、PP；
 *             兼容 PWM-CP(J1772)/LIN-CP/PLC，互操作 P1(DIN 70121)/P2(ISO 15118-2)
 *   chademo   日标 CHAdeMO 10 触点：DC±/FG/Charger12V/连接检查/
 *             启停1/启停2/充电使能/CAN_H/CAN_L；CAN 通信、车辆主导
 * pins: kind=power 主功率 / pe 保护接地 / signal 信号(画外部支线) / aux 空或辅助触头(不接线)
 * lead: 信号/PE 引出线端点（相对枪心），外部接线接到引出端
 * ============================================================ */
window.EVSE_CONNECTOR_LIB = (function () {
  'use strict';

  const ID = 'EVSE-CONNECTOR-LIB';
  const VERSION = '1.1.0';

  const CONNECTORS = Object.freeze({
    'gbt-dc': {
      name: '国标 GB/T 20234.3 直流枪（9 芯）',
      comm: 'GB/T 27930 CAN 250kbps',
      outline: [{ dx: 0, dy: 0, r: 27, w: 1.8 }, { dx: 0, dy: 0, r: 22, w: 0.8 }],
      pins: [
        { id: 'DC-', kind: 'power', dx: -18, dy: -9, r: 6.5 },
        { id: 'DC+', kind: 'power', dx: 18, dy: -9, r: 6.5 },
        { id: 'PE', kind: 'pe', dx: 0, dy: 2, r: 5 },
        { id: 'CC1', kind: 'signal', dx: -8, dy: 15, r: 3 },
        { id: 'CC2', kind: 'signal', dx: 8, dy: 15, r: 3 },
        { id: 'S+', kind: 'signal', dx: -19, dy: 9, r: 3 },
        { id: 'S-', kind: 'signal', dx: 19, dy: 9, r: 3 },
        { id: 'A+', kind: 'aux', dx: -4, dy: -20, r: 2.5 },
        { id: 'A-', kind: 'aux', dx: 4, dy: -20, r: 2.5 }
      ]
    },
    'ccs2': {
      name: '欧标 CCS2（IEC 62196-3 Configuration FF）',
      comm: 'DIN 70121 / ISO 15118（HomePlug Green PHY）',
      outline: [{ dx: 0, dy: -16, r: 16, w: 1.6 }],
      pins: [
        { id: 'DC-', kind: 'power', dx: -18, dy: 20, r: 9.5 },
        { id: 'DC+', kind: 'power', dx: 18, dy: 20, r: 9.5 },
        { id: 'PE', kind: 'pe', dx: 0, dy: -27, r: 3, lead: { x: 40, y: -36 } },
        { id: 'PP', kind: 'signal', dx: -8, dy: -21, r: 2.5, lead: { x: -26, y: -21 } },
        { id: 'CP', kind: 'signal', dx: 8, dy: -21, r: 2.5, lead: { x: 26, y: -21 } },
        { id: 'L1', kind: 'aux', dx: -9, dy: -12, r: 2.2 },
        { id: 'L2', kind: 'aux', dx: -3, dy: -9, r: 2.2 },
        { id: 'L3', kind: 'aux', dx: 3, dy: -9, r: 2.2 },
        { id: 'N', kind: 'aux', dx: 9, dy: -12, r: 2.2 }
      ]
    },
    'ccs1': {
      name: '美标 CCS1（IEC 62196-3 Configuration EE / Combo 1）',
      comm: 'DIN 70121 / ISO 15118 / SAE J2847-2',
      outline: [{ dx: 0, dy: -16, r: 16, w: 1.6 }],
      pins: [
        { id: 'DC-', kind: 'power', dx: -18, dy: 20, r: 9.5 },
        { id: 'DC+', kind: 'power', dx: 18, dy: 20, r: 9.5 },
        { id: 'PE', kind: 'pe', dx: 0, dy: -27, r: 3, lead: { x: 40, y: -36 } },
        { id: 'PP', kind: 'signal', dx: -8, dy: -21, r: 2.5, lead: { x: -26, y: -21 } },
        { id: 'CP', kind: 'signal', dx: 8, dy: -21, r: 2.5, lead: { x: 26, y: -21 } },
        { id: 'L1', kind: 'aux', dx: -9, dy: -12, r: 2.2 },
        { id: 'N', kind: 'aux', dx: 0, dy: -9, r: 2.2 },
        { id: 'L2', kind: 'aux', dx: 9, dy: -12, r: 2.2 }
      ]
    },
    'nacs': {
      name: '美标 NACS（SAE J3400，5 触点交直流一体）',
      comm: 'ISO 15118 PLC / PWM-CP（SAE J1772）/ LIN-CP',
      outline: [{ dx: 0, dy: -2, r: 24, w: 1.6 }],
      pins: [
        { id: 'DC-', kind: 'power', dx: -18, dy: 14, r: 8 },
        { id: 'DC+', kind: 'power', dx: 18, dy: 14, r: 8 },
        { id: 'PE', kind: 'pe', dx: 0, dy: -16, r: 3, lead: { x: 34, y: -26 } },
        { id: 'CP', kind: 'signal', dx: -9, dy: -6, r: 2.5, lead: { x: -26, y: -6 } },
        { id: 'PP', kind: 'signal', dx: 9, dy: -6, r: 2.5, lead: { x: 26, y: -6 } }
      ]
    },
    'chademo': {
      name: '日标 CHAdeMO（10 针，车辆主导）',
      comm: 'CHAdeMO 协议 · CAN 总线',
      outline: [{ dx: 0, dy: 0, r: 27, w: 1.8 }],
      pins: [
        { id: 'DC-', kind: 'power', dx: -18, dy: -8, r: 7 },
        { id: 'DC+', kind: 'power', dx: 18, dy: -8, r: 7 },
        { id: 'PE', label: 'FG / PE', kind: 'pe', dx: 0, dy: -19, r: 4.2, lead: { x: 30, y: -28 } },
        { id: 'CHARGER_12V', label: 'Charger 12V', kind: 'aux-power', dx: -13, dy: 5, r: 2.5, required: true },
        { id: 'CONNECTION_CHECK', label: '连接检查', kind: 'signal', dx: 0, dy: 4, r: 2.5, signalRole: 'CHADEMO:CONNECTION_CHECK' },
        { id: 'CHARGE_ENABLE', label: '充电使能', kind: 'signal', dx: 13, dy: 5, r: 2.5, signalRole: 'CHADEMO:CHARGE_ENABLE' },
        { id: 'START_STOP_1', label: '启停 1', kind: 'signal', dx: -14, dy: 16, r: 2.5, signalRole: 'CHADEMO:START_STOP_1' },
        { id: 'CAN_H', kind: 'signal', dx: -5, dy: 15, r: 2.5, signalRole: 'CHADEMO_CAN:H' },
        { id: 'CAN_L', kind: 'signal', dx: 5, dy: 15, r: 2.5, signalRole: 'CHADEMO_CAN:L' },
        { id: 'START_STOP_2', label: '启停 2', kind: 'signal', dx: 14, dy: 16, r: 2.5, signalRole: 'CHADEMO:START_STOP_2' }
      ]
    }
  });

  return {
    ID, VERSION, CONNECTORS,
    /* Unknown connector identifiers are an electrical design error.  A
       silent CCS2 fallback can make a drawing look valid while changing the
       physical pinout, so callers must handle a missing definition. */
    get: (type) => CONNECTORS[type] || null
  };
})();
