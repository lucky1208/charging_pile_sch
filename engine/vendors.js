/* ============================================================
 * 受控设备目录与可追溯概念估算（充电桩）
 * ------------------------------------------------------------
 * 这是有意做成的“示例目录”，不是报价，也不是产品合规声明。
 * 条目一律使用通用示例厂商名，避免把具体品牌型号伪装成选型结论。
 * 所有价格统一为 CNY 并绑定声明单位，避免计算代码混用
 * 元/Wh、元/kWh、万元/台等口径。
 * ============================================================ */
window.VENDORS = (function () {
  'use strict';

  const CATALOG_STATUS = 'SAMPLE_CATALOGUE—RFQ_REQUIRED';
  const CAT = {
    module: {
      name: '充电功率模块', capacityKey: 'kW', priceUnit: 'CNY/kW', options: [
        { vendor: '通用示例 A', model: '风冷 30kW 宽压模块', capacity: 30, priceCnyPerUnit: 400, eff: 95.5, rel: 4, delWeeks: 5, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 B', model: '风冷 40kW 宽压模块', capacity: 40, priceCnyPerUnit: 380, eff: 96.0, rel: 5, delWeeks: 7, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 C', model: '液冷 60kW 宽压模块', capacity: 60, priceCnyPerUnit: 430, eff: 96.5, rel: 5, delWeeks: 9, source: '示例目录', asOf: '2026-08-17' }
      ]
    },
    battery: {
      name: '储能电池簇（含 BCU）', capacityKey: 'kWh', priceUnit: 'CNY/kWh', options: [
        { vendor: '通用示例 A', model: 'LFP 电池簇', capacity: 260, priceCnyPerUnit: 700, eff: 95.0, rel: 5, delWeeks: 8, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 B', model: 'LFP 电池簇', capacity: 260, priceCnyPerUnit: 650, eff: 94.0, rel: 4, delWeeks: 7, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 C', model: 'LFP 电池簇', capacity: 260, priceCnyPerUnit: 620, eff: 93.5, rel: 4, delWeeks: 6, source: '示例目录', asOf: '2026-08-17' }
      ]
    },
    pcs: {
      name: '储能变流器（PCS）', capacityKey: 'kW', priceUnit: 'CNY/kW', options: [
        { vendor: '通用示例 A', model: '双向 PCS', capacity: 250, priceCnyPerUnit: 760, eff: 98.5, rel: 5, delWeeks: 7, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 B', model: '双向 PCS', capacity: 250, priceCnyPerUnit: 680, eff: 98.0, rel: 4, delWeeks: 6, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 C', model: '双向 PCS', capacity: 250, priceCnyPerUnit: 640, eff: 97.8, rel: 4, delWeeks: 6, source: '示例目录', asOf: '2026-08-17' }
      ]
    },
    dcdc: {
      name: '储能双向 DC/DC 变换器', capacityKey: 'kW', priceUnit: 'CNY/kW', options: [
        { vendor: '通用示例 A', model: '双向 DC/DC 模块', capacity: 60, priceCnyPerUnit: 620, eff: 98.0, rel: 5, delWeeks: 7, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 B', model: '双向 DC/DC 模块', capacity: 60, priceCnyPerUnit: 560, eff: 97.5, rel: 4, delWeeks: 6, source: '示例目录', asOf: '2026-08-17' },
        { vendor: '通用示例 C', model: '双向 DC/DC 模块', capacity: 60, priceCnyPerUnit: 520, eff: 97.0, rel: 4, delWeeks: 5, source: '示例目录', asOf: '2026-08-17' }
      ]
    }
  };

  const WEIGHTS = {
    cost: { c: 0.50, e: 0.15, r: 0.20, d: 0.15 },
    reliability: { c: 0.15, e: 0.20, r: 0.50, d: 0.15 },
    balance: { c: 0.35, e: 0.25, r: 0.25, d: 0.15 }
  };

  function normalise(items, key, value, higherBetter) {
    const values = items.map((x) => x[key]);
    const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (hi === lo) return 1;
    const score = (value - lo) / (hi - lo);
    return higherBetter ? score : 1 - score;
  }

  function select(cat, pref, requirement) {
    const c = CAT[cat];
    if (!c) return null;
    const required = Number(requirement && requirement.requiredCapacity) || 0;
    const compatible = c.options.filter((o) => !required || o.capacity >= required);
    const hasCapacityMatch = compatible.length > 0;
    /* Keep the full sample list visible for RFQ research, but never label an
     * undersized catalogue entry as a recommendation. */
    const candidates = (hasCapacityMatch ? compatible : c.options).map((x) => Object.assign({}, x));
    const w = WEIGHTS[pref] || WEIGHTS.balance;
    candidates.forEach((x) => {
      x.score = Math.round(1000 * (
        w.c * normalise(candidates, 'priceCnyPerUnit', x.priceCnyPerUnit, false) +
        w.e * normalise(candidates, 'eff', x.eff, true) +
        w.r * normalise(candidates, 'rel', x.rel, true) +
        w.d * normalise(candidates, 'delWeeks', x.delWeeks, false)
      )) / 10;
      x.compatible = x.capacity >= required;
    });
    candidates.sort((a, b) => b.score - a.score || a.vendor.localeCompare(b.vendor, 'zh-CN') || a.model.localeCompare(b.model));
    return {
      name: c.name, category: cat, capacityKey: c.capacityKey, priceUnit: c.priceUnit,
      requirement: required || null, options: candidates,
      recommended: hasCapacityMatch ? candidates[0] : null,
      pref: pref || 'balance',
      status: hasCapacityMatch ? CATALOG_STATUS : 'NO_CAPACITY_MATCH—RFQ_REQUIRED',
      note: hasCapacityMatch ? '目录容量匹配；仍需 RFQ 与技术澄清。' : '当前受控示例目录没有满足所需容量的条目；不得推荐或采用现有示例型号。'
    };
  }

  function estimate(option, quantity, capacityPerUnit) {
    if (!option) return { unitCny: 0, totalCny: 0 };
    const cap = Math.max(0, Number(capacityPerUnit) || 0);
    const qty = Math.max(0, Number(quantity) || 0);
    const unitCny = option.priceCnyPerUnit * cap;
    return { unitCny, totalCny: unitCny * qty, priceUnit: option.priceCnyPerUnit, basis: option.priceCnyPerUnit + ' ' + option.vendor + ' ' + option.model };
  }

  return { CAT, CATALOG_STATUS, select, estimate };
})();
