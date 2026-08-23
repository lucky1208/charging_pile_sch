#!/usr/bin/env node
'use strict';

const workbench = require('./lib');

const COMMAND_OPTIONS = Object.freeze({
  extract: new Set(['source', 'candidate', 'document-version', 'pdf-text', 'store', 'actor', 'reason']),
  'validate-candidate': new Set(['candidate']),
  inspect: new Set(['store', 'record']),
  history: new Set(['store', 'record']),
  verify: new Set(['store', 'record']),
  review: new Set(['store', 'record', 'actor', 'reason']),
  approve: new Set(['store', 'record', 'actor', 'reason']),
  deprecate: new Set(['store', 'record', 'actor', 'reason']),
  export: new Set(['store', 'record', 'out'])
});

function usage() {
  return `EVSE component catalog workbench (data only; never executes source content)

Usage:
  node component-workbench/cli.js extract --source <manual.txt|data.json|manual.pdf> \\
    --candidate <candidate.json> [--pdf-text <externally-extracted.txt>] \\
    --document-version <version> --store <dir> --actor <identity> --reason <text>
  node component-workbench/cli.js validate-candidate --candidate <candidate.json>
  node component-workbench/cli.js review|approve|deprecate --store <dir> --record <id> \\
    --actor <identity> --reason <text>
  node component-workbench/cli.js inspect|history|verify --store <dir> --record <id>
  node component-workbench/cli.js export --store <dir> --record <id[,id...]> --out <catalog.json>

PDF note: the CLI never loads extractor modules or runs commands. Produce plain text
outside this process and pass it with --pdf-text. The API also accepts an explicit
caller-owned pdfTextExtractor callback.`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return { command: 'help', options: {} };
  if (!COMMAND_OPTIONS[command]) throw new workbench.WorkbenchError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
  const allowed = COMMAND_OPTIONS[command];
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new workbench.WorkbenchError('UNEXPECTED_ARGUMENT', `Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new workbench.WorkbenchError('UNKNOWN_OPTION', `Option --${key} is not valid for ${command}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new workbench.WorkbenchError('OPTION_VALUE_REQUIRED', `Option --${key} requires a value`);
    if (Object.hasOwn(options, key)) throw new workbench.WorkbenchError('DUPLICATE_OPTION', `Option --${key} was supplied more than once`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key]) throw new workbench.WorkbenchError('OPTION_REQUIRED', `--${key} is required`);
  return options[key];
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(argv) {
  const { command, options } = parseArgs(argv);
  if (command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'validate-candidate') {
    const fs = require('node:fs');
    const { parseJsonBytes, readLimited } = require('./lib/util');
    const { LIMITS } = require('./lib/constants');
    const candidate = parseJsonBytes(readLimited(required(options, 'candidate'), LIMITS.CANDIDATE_BYTES), 'Candidate');
    workbench.validateCandidate(candidate);
    output({ ok: true, schemaVersion: candidate.schemaVersion, recordId: candidate.recordId });
    return;
  }

  if (command === 'extract') {
    const result = await workbench.extractToStore({
      sourcePath: required(options, 'source'),
      candidatePath: options.candidate,
      pdfTextPath: options['pdf-text'],
      documentVersion: required(options, 'document-version'),
      storeRoot: required(options, 'store'),
      actor: required(options, 'actor'),
      reason: required(options, 'reason')
    });
    output({ ok: true, recordId: result.record.recordId, revision: result.record.revision, state: result.record.state, sha256: result.digest });
    return;
  }

  const storeRoot = required(options, 'store');
  const recordId = required(options, 'record');
  if (command === 'inspect') {
    const latest = workbench.loadLatest(storeRoot, recordId);
    output({ ...latest.record, revisionSha256: latest.digest });
    return;
  }
  if (command === 'history') {
    output({ recordId, history: workbench.historySummary(storeRoot, recordId) });
    return;
  }
  if (command === 'verify') {
    const entries = workbench.loadHistory(storeRoot, recordId);
    output({ ok: true, recordId, revisions: entries.length, latestState: entries.at(-1).record.state, latestSha256: entries.at(-1).digest });
    return;
  }
  if (command === 'export') {
    const recordIds = recordId.split(',').map(value => value.trim()).filter(Boolean);
    const result = workbench.exportCatalog(storeRoot, recordIds, required(options, 'out'));
    output({ ok: true, outPath: result.outPath, catalogVersion: result.catalog.catalogVersion, records: result.catalog.records.length });
    return;
  }

  const audit = { actor: required(options, 'actor'), reason: required(options, 'reason') };
  const action = command === 'review' ? workbench.review : command === 'approve' ? workbench.approve : workbench.deprecate;
  const result = action(storeRoot, recordId, audit);
  output({ ok: true, recordId, revision: result.record.revision, state: result.record.state, sha256: result.digest });
}

run(process.argv.slice(2)).catch(error => {
  const known = error instanceof workbench.WorkbenchError;
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: known ? error.code : 'UNEXPECTED_ERROR',
    message: error.message,
    details: known ? error.details : undefined
  }, null, 2)}\n`);
  process.exitCode = known ? 2 : 1;
});
