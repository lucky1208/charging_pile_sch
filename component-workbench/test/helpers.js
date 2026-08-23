'use strict';

const fs = require('node:fs');
const path = require('node:path');

const QUOTE = 'EVSE component evidence statement';

function evidence() {
  return [{
    page: 1,
    bbox: { x: 10, y: 20, width: 120, height: 12, unit: 'PDF_PT' },
    quote: QUOTE
  }];
}

function claim(value, confidence = 0.99) {
  return { value, confidence, evidence: evidence() };
}

function entity(kind, fields, confidence = 0.99) {
  return { kind, confidence, evidence: evidence(), ...fields };
}

function candidate(recordId = 'acme.dc-contactor.x100') {
  const ports = [
    entity('FunctionalPort', {
      id: claim('DC_IN_POS'),
      name: claim('DC positive input'),
      direction: claim('INPUT'),
      electricalDomain: claim('HV_DC_POS'),
      purpose: claim('Positive high-voltage input'),
      physicalTerminalRefs: [claim('X1/1')]
    }),
    entity('FunctionalPort', {
      id: claim('DC_OUT_POS'),
      name: claim('DC positive output'),
      direction: claim('OUTPUT'),
      electricalDomain: claim('HV_DC_POS'),
      purpose: claim('Positive high-voltage output'),
      physicalTerminalRefs: [claim('X1/2')]
    }),
    entity('FunctionalPort', {
      id: claim('COIL_POS'),
      name: claim('Coil positive'),
      direction: claim('INPUT'),
      electricalDomain: claim('AUX_24V_POS'),
      purpose: claim('Contactor coil drive'),
      physicalTerminalRefs: [claim('X2/A1')]
    })
  ];

  const x1 = entity('Connector', {
    id: claim('X1'),
    name: claim('Main power studs'),
    type: claim('BOLTED_STUD_PAIR'),
    terminals: [
      entity('PhysicalTerminal', {
        id: claim('1'),
        designation: claim('1 (+ input)'),
        function: claim('DC_IN_POS'),
        electricalDomain: claim('HV_DC_POS'),
        direction: claim('INPUT'),
        functionalPortRefs: [claim('DC_IN_POS')],
        attributes: []
      }),
      entity('PhysicalTerminal', {
        id: claim('2'),
        designation: claim('2 (+ output)'),
        function: claim('DC_OUT_POS'),
        electricalDomain: claim('HV_DC_POS'),
        direction: claim('OUTPUT'),
        functionalPortRefs: [claim('DC_OUT_POS')],
        attributes: []
      })
    ]
  });

  const x2 = entity('Connector', {
    id: claim('X2'),
    name: claim('Coil connector'),
    type: claim('PLUGGABLE'),
    terminals: [
      entity('PhysicalTerminal', {
        id: claim('A1'),
        designation: claim('A1'),
        function: claim('COIL_POS'),
        electricalDomain: claim('AUX_24V_POS'),
        direction: claim('INPUT'),
        functionalPortRefs: [claim('COIL_POS')],
        attributes: [entity('Attribute', { key: claim('ratedVoltage'), value: claim(24), unit: claim('VDC') })]
      })
    ]
  });

  return {
    schemaVersion: 'evse.component-candidate/v1',
    recordId,
    deviceClass: entity('DeviceClass', {
      id: claim('DC_CONTACTOR'),
      name: claim('DC contactor'),
      description: claim('Normally-open high-voltage DC contactor'),
      functionalPorts: ports
    }),
    partVariant: entity('PartVariant', {
      id: claim('ACME_X100_24V'),
      manufacturer: claim('ACME'),
      model: claim('X100-24V'),
      deviceClassRef: claim('DC_CONTACTOR'),
      documentRevision: claim('Rev C'),
      description: claim('1000 VDC contactor with 24 VDC coil'),
      connectors: [x1, x2],
      functionalUnits: [
        entity('FunctionalUnit', {
          id: claim('MAIN_CONTACT'),
          name: claim('Main switching contact'),
          type: claim('NORMALLY_OPEN_CONTACT'),
          connectorRefs: [claim('X1')],
          functionalPortRefs: [claim('DC_IN_POS'), claim('DC_OUT_POS')],
          attributes: []
        }),
        entity('FunctionalUnit', {
          id: claim('COIL'),
          name: claim('Electromagnetic coil'),
          type: claim('ACTUATOR_COIL'),
          connectorRefs: [claim('X2')],
          functionalPortRefs: [claim('COIL_POS')],
          attributes: [entity('Attribute', { key: claim('nominalVoltage'), value: claim(24), unit: claim('VDC') })]
        })
      ],
      attributes: [entity('Attribute', { key: claim('maximumVoltage'), value: claim(1000), unit: claim('VDC') })]
    })
  };
}

function writeFixture(root, value = candidate(), extension = '.txt') {
  const sourcePath = path.join(root, `manual${extension}`);
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(sourcePath, `${QUOTE}\nManufacturer data revision C\n`, 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(value, null, 2), 'utf8');
  return { sourcePath, candidatePath };
}

module.exports = { QUOTE, evidence, claim, entity, candidate, writeFixture };
