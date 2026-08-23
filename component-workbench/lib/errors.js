'use strict';

class WorkbenchError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WorkbenchError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkbenchError(code, message, details);
}

module.exports = { WorkbenchError, fail };
