'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateSentinelState } = require('../validators/contract-validator.cjs');

const SIGNATURE_FIELD = '__signature';
const SUPPORTED_ALGORITHM = 'schema-validation';

function verificationFromValidation(validation) {
  if (validation.ok) {
    return {
      valid: true,
      reason: 'schema valid (OpenCode adapter does not use HMAC)',
      unsigned: true,
      key_unavailable: false,
      algorithm: SUPPORTED_ALGORITHM,
    };
  }
  return {
    valid: false,
    reason: `schema invalid: ${validation.code || 'UNKNOWN'}${validation.message ? ` ${validation.message}` : ''}`,
    unsigned: false,
    key_unavailable: false,
    algorithm: SUPPORTED_ALGORITHM,
  };
}

function verifyState(stateObj, opts = {}) {
  const validationOptions = opts.validationOptions || opts;
  return verificationFromValidation(validateSentinelState(stateObj, validationOptions));
}

function signState(stateObj) {
  if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) {
    throw new TypeError('signState: stateObj must be an object');
  }
  const { [SIGNATURE_FIELD]: _signature, ...unsigned } = stateObj;
  return unsigned;
}

function readVerifiedState(filePath, opts = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const state = JSON.parse(raw);
  const verification = verifyState(state, opts);
  return { state, verification };
}

function writeSignedState(filePath, state) {
  const unsigned = signState(state);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(unsigned, null, 2));
  fs.renameSync(tmpPath, filePath);
  return unsigned;
}

module.exports = {
  verifyState,
  readVerifiedState,
  signState,
  writeSignedState,
  SIGNATURE_FIELD,
  SUPPORTED_ALGORITHM,
};
