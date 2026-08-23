'use strict';

const { prepareDraft } = require('./importer');
const store = require('./store');
const exporter = require('./exporter');
const validator = require('./validator');
const constants = require('./constants');
const { WorkbenchError } = require('./errors');

async function extractToStore(options) {
  const prepared = await prepareDraft(options);
  return store.createDraft(options.storeRoot, prepared, {
    actor: options.actor,
    reason: options.reason
  });
}

module.exports = {
  extractToStore,
  prepareDraft,
  review: store.review,
  approve: store.approve,
  deprecate: store.deprecate,
  loadHistory: store.loadHistory,
  loadLatest: store.loadLatest,
  historySummary: store.historySummary,
  ...exporter,
  ...validator,
  ...constants,
  WorkbenchError
};
