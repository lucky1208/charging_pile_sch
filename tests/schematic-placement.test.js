'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const IR = require('../engine/drawing-ir.js');
const PLACEMENT = require('../engine/schematic-placement.js');

function terminal(id, netClass, domain, direction, extra) {
  return Object.assign({ id, label: id, netClass, domain, direction, required: true }, extra || {});
}

function instance(id, kind, system, terminals) {
  return {
    id, kind, system, name: kind + ' ' + id,
    referenceDesignation: 'EVSE-' + id,
    terminals
  };
}

function modelFixture() {
  const instances = [
    instance('AC-IN', 'ac-incomer', 'ac', [
      terminal('L1', 'POWER_AC', 'AC_MAINS', 'out', { phase: 'L1' }),
      terminal('L2', 'POWER_AC', 'AC_MAINS', 'out', { phase: 'L2' })
    ]),
    instance('QS1', 'ac-isolator', 'ac', [
      terminal('IN1', 'POWER_AC', 'AC_MAINS', 'in', { phase: 'L1' }),
      terminal('OUT1', 'POWER_AC', 'AC_MAINS', 'out', { phase: 'L1' }),
      terminal('IN2', 'POWER_AC', 'AC_MAINS', 'in', { phase: 'L2' }),
      terminal('OUT2', 'POWER_AC', 'AC_MAINS', 'out', { phase: 'L2' })
    ]),
    instance('LOAD', 'power-module-array', 'power', [
      terminal('L1', 'POWER_AC', 'AC_MAINS', 'in', { phase: 'L1' }),
      terminal('L2', 'POWER_AC', 'AC_MAINS', 'in', { phase: 'L2' })
    ]),
    instance('CCU', 'charge-controller', 'control', [
      terminal('DO1', 'SIGNAL_CTRL', 'CONTROL', 'out'),
      terminal('DO2', 'SIGNAL_CTRL', 'CONTROL', 'out')
    ]),
    instance('K1', 'connector-lock', 'gun', [terminal('DRIVE', 'SIGNAL_CTRL', 'CONTROL', 'in')]),
    instance('K2', 'connector-lock', 'gun', [terminal('DRIVE', 'SIGNAL_CTRL', 'CONTROL', 'in')])
  ];
  const nets = [
    { id: 'AC-L1-A', netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L1', members: [
      { instanceId: 'AC-IN', terminalId: 'L1' }, { instanceId: 'QS1', terminalId: 'IN1' }
    ] },
    { id: 'AC-L1-B', netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L1', members: [
      { instanceId: 'QS1', terminalId: 'OUT1' }, { instanceId: 'LOAD', terminalId: 'L1' }
    ] },
    { id: 'AC-L2-A', netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L2', members: [
      { instanceId: 'AC-IN', terminalId: 'L2' }, { instanceId: 'QS1', terminalId: 'IN2' }
    ] },
    { id: 'AC-L2-B', netClass: 'POWER_AC', domain: 'AC_MAINS', phase: 'L2', members: [
      { instanceId: 'QS1', terminalId: 'OUT2' }, { instanceId: 'LOAD', terminalId: 'L2' }
    ] },
    { id: 'CTRL-1', netClass: 'SIGNAL_CTRL', domain: 'CONTROL', members: [
      { instanceId: 'CCU', terminalId: 'DO1' }, { instanceId: 'K1', terminalId: 'DRIVE' }
    ] },
    { id: 'CTRL-2', netClass: 'SIGNAL_CTRL', domain: 'CONTROL', members: [
      { instanceId: 'CCU', terminalId: 'DO2' }, { instanceId: 'K2', terminalId: 'DRIVE' }
    ] }
  ];
  const circuits = [
    ['C1', 'AC-L1-A', 'AC-IN', 'L1', 'QS1', 'IN1', 'POWER_AC', 'AC_MAINS'],
    ['C2', 'AC-L1-B', 'QS1', 'OUT1', 'LOAD', 'L1', 'POWER_AC', 'AC_MAINS'],
    ['C3', 'AC-L2-A', 'AC-IN', 'L2', 'QS1', 'IN2', 'POWER_AC', 'AC_MAINS'],
    ['C4', 'AC-L2-B', 'QS1', 'OUT2', 'LOAD', 'L2', 'POWER_AC', 'AC_MAINS'],
    ['C5', 'CTRL-1', 'CCU', 'DO1', 'K1', 'DRIVE', 'SIGNAL_CTRL', 'CONTROL'],
    ['C6', 'CTRL-2', 'CCU', 'DO2', 'K2', 'DRIVE', 'SIGNAL_CTRL', 'CONTROL']
  ].map((row) => ({
    id: row[0], netId: row[1], from: row[2], fromPort: row[3], to: row[4], toPort: row[5],
    netClass: row[6], domain: row[7], direction: 'from-to',
    kind: /^SIGNAL/.test(row[6]) ? 'signal' : 'electrical'
  }));
  return { schemaVersion: '4.0.0', instances, equipment: instances, nets, circuits };
}

test('compiler produces exact, keepout-safe Drawing IR only from EDEM v4', () => {
  const model = modelFixture();
  const result = PLACEMENT.compile(model, { columns: 3 });
  assert.equal(result.drawingIR.schema, IR.SCHEMA);
  assert.equal(result.drawingIR.devices.length, model.instances.length);
  assert.equal(result.drawingIR.routes.length, model.circuits.length);
  assert.equal(result.drawingIR.coverage.ok, true);
  assert.deepEqual(result.drawingIR.violations, []);
  assert.ok(result.drawingIR.routes.every((route) => route.id === route.circuitId));
  assert.ok(result.drawingIR.routes.every((route) => route.segments.every((segment) =>
    segment.x1 === segment.x2 || segment.y1 === segment.y2)));
});

test('placement and route hash are invariant to model collection order', () => {
  const first = modelFixture();
  const second = modelFixture();
  second.instances.reverse();
  second.equipment = second.instances;
  second.nets.reverse();
  second.circuits.reverse();
  const a = PLACEMENT.compile(first, { columns: 3 });
  const b = PLACEMENT.compile(second, { columns: 3 });
  assert.equal(IR.drawingIRHash(a.drawingIR), IR.drawingIRHash(b.drawingIR));
});

test('exact terminal or net mutations fail before geometry is emitted', () => {
  const badTerminal = modelFixture();
  badTerminal.circuits[0].fromPort = 'MISSING';
  assert.throws(() => PLACEMENT.compile(badTerminal), (error) =>
    error instanceof PLACEMENT.SchematicCompileError && error.code === 'SCHEMATIC_MODEL_INCOMPLETE');

  const missingNet = modelFixture();
  missingNet.nets = [];
  assert.throws(() => PLACEMENT.compile(missingNet), (error) =>
    error instanceof PLACEMENT.SchematicCompileError && error.code === 'SCHEMATIC_MODEL_INCOMPLETE');
});

