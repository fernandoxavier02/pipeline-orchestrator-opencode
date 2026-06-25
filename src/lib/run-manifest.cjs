'use strict';

const VALID_STATUSES = ['ready', 'partial', 'cancelled', 'executing', 'completed', 'sealed'];
const VALID_PHASES = [0, 1, 2, 3];
const VALID_TYPES = ['Feature', 'Bug Fix', 'Audit', 'User Story', 'UX Simulation', 'Spec', 'Unknown'];
const VALID_COMPLEXITIES = ['SIMPLES', 'MEDIA', 'COMPLEXA', 'unknown'];
const VALID_HANDOFF = ['run-now', 'stop', null];
const REQUIRED_FIELDS = [
  'schema_version', 'run_id', 'created_at', 'updated_at', 'status', 'phase',
  'step_completed', 'type', 'complexity', 'brainstorm_completed',
  'spec_lifecycle_completed', 'handoff_decision', 'linked_pipeline_doc_path', 'notes',
];

function notesToObject(notes) {
  if (notes && typeof notes === 'object' && !Array.isArray(notes)) return { ...notes };
  if (typeof notes === 'string' && notes.trim()) {
    try {
      const parsed = JSON.parse(notes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* not JSON */ }
  }
  return {};
}

class RunManifest {
  constructor(data) { this._data = Object.freeze({ ...data }); }
  get run_id() { return this._data.run_id; }
  get status() { return this._data.status; }
  get phase() { return this._data.phase; }
  get step_completed() { return this._data.step_completed; }

  static fromObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('manifest must be an object');
    for (const field of REQUIRED_FIELDS) if (!(field in obj)) throw new Error(`missing required field: ${field}`);
    if (obj.schema_version !== 1) throw new Error(`invalid schema_version: ${obj.schema_version}`);
    if (!VALID_STATUSES.includes(obj.status)) throw new Error(`invalid status: ${obj.status}`);
    if (!VALID_PHASES.includes(obj.phase)) throw new Error(`invalid phase: ${obj.phase}`);
    if (!VALID_TYPES.includes(obj.type)) throw new Error(`invalid type: ${obj.type}`);
    if (!VALID_COMPLEXITIES.includes(obj.complexity)) throw new Error(`invalid complexity: ${obj.complexity}`);
    if (!VALID_HANDOFF.includes(obj.handoff_decision)) throw new Error(`invalid handoff_decision: ${obj.handoff_decision}`);
    return new RunManifest(obj);
  }

  toYaml() {
    const d = this._data;
    const str = (value) => value === null ? 'null' : JSON.stringify(value);
    const raw = (value) => value === null ? 'null' : String(value);
    return [
      `schema_version: ${d.schema_version}`,
      `run_id: ${str(d.run_id)}`,
      `created_at: ${str(d.created_at)}`,
      `updated_at: ${str(d.updated_at)}`,
      `status: ${str(d.status)}`,
      `phase: ${d.phase}`,
      `step_completed: ${raw(d.step_completed)}`,
      `type: ${str(d.type)}`,
      `complexity: ${str(d.complexity)}`,
      `brainstorm_completed: ${d.brainstorm_completed}`,
      `spec_lifecycle_completed: ${d.spec_lifecycle_completed}`,
      `handoff_decision: ${str(d.handoff_decision)}`,
      `linked_pipeline_doc_path: ${str(d.linked_pipeline_doc_path)}`,
      `notes: ${JSON.stringify(d.notes)}`,
      '',
    ].join('\n');
  }

  static fromYaml(text) {
    const obj = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const idx = line.indexOf(':');
      const key = line.slice(0, idx).trim();
      const raw = line.slice(idx + 1).trim();
      if (raw === 'null') obj[key] = null;
      else if (raw === 'true') obj[key] = true;
      else if (raw === 'false') obj[key] = false;
      else if (/^-?\d+$/.test(raw)) obj[key] = parseInt(raw, 10);
      else if (raw.startsWith('"')) obj[key] = JSON.parse(raw);
      else obj[key] = raw;
    }
    return RunManifest.fromObject(obj);
  }

  toObject() { return { ...this._data }; }
  notesObject() { return notesToObject(this._data.notes); }
}

module.exports = { RunManifest, notesToObject };
