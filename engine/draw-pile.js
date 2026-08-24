/* ============================================================
 * EVSE schematic integration entry
 * ------------------------------------------------------------
 * Topology source: R.design.instances / nets / circuits only.
 * Geometry source: EVSE_SCHEMATIC_PLACEMENT -> EVSE_DRAWING_IR only.
 * Rendering source: EVSE_SVG_IR_RENDERER only.
 * ============================================================ */
window.drawPile = function drawPile(result) {
  'use strict';
  const R = result || {};
  const placement = window.EVSE_SCHEMATIC_PLACEMENT;
  const renderer = window.EVSE_SVG_IR_RENDERER;
  if (!R.design) throw new Error('EDEM design model is required for schematic rendering.');
  if (!placement || typeof placement.compile !== 'function') {
    throw new Error('EVSE_SCHEMATIC_PLACEMENT is not loaded.');
  }
  if (!renderer || typeof renderer.render !== 'function') {
    throw new Error('EVSE_SVG_IR_RENDERER is not loaded.');
  }

  const compiled = placement.compile(R.design);
  /* The exact audited IR is retained for DXF/export/package consumers. */
  R.drawingIR = compiled.drawingIR;
  R.drawingPlan = compiled.plan;
  R.drawingPages = compiled.sheets;
  R.drawingSheet = compiled.plan.sheet;
  R.drawingDocumentControl = Object.freeze({
    source: 'EVSE_SCHEMATIC_PLACEMENT',
    format: compiled.plan.sheet && compiled.plan.sheet.format,
    orientation: compiled.plan.sheet && compiled.plan.sheet.orientation,
    widthMm: compiled.plan.sheet && compiled.plan.sheet.widthMm,
    heightMm: compiled.plan.sheet && compiled.plan.sheet.heightMm,
    scale: compiled.plan.sheet && compiled.plan.sheet.scale,
    page: Object.freeze({ current: 1, total: compiled.sheets.length || 1 })
  });
  R.drawingGeometryHash = window.EVSE_DRAWING_IR.drawingIRHash(compiled.drawingIR);
  return renderer.render(compiled, R);
};
