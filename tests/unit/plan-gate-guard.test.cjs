'use strict';

// B3 (RED→GREEN) — Plan-Mode gate enforced in guardToolExecution for edit/write AND bash.
// armed (required && !approved) blocks; approved allows; absent planGate = legacy allow; malformed
// planGate fails closed; bash write-commands blocked while armed but read commands pass.

const assert = require('node:assert/strict');
const path = require('node:path');
const { guardToolExecution } = require('../../src/opencode/plugin-guard.cjs');
const { detectShellWrite } = require('../../src/opencode/detect-shell-write.cjs');

const root = path.resolve(__dirname, '..', '..');
const surface = path.join(root, 'src', 'opencode');
const inScope = path.join(surface, 'foo.cjs');

function run(planGate, toolName, args) {
  return guardToolExecution({ activeRun: { allowedSurfaces: [surface], planGate }, toolName, args });
}

// armed → edit blocked even INSIDE the allowed surface (plan gate fires first)
let r = run({ required: true, approved: false }, 'edit', { filePath: inScope });
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_ACTIVE');

// approved → edit allowed (inside surface)
r = run({ required: true, approved: true }, 'edit', { filePath: inScope });
assert.equal(r.ok, true);

// no planGate (legacy) → edit allowed (falls through to surface check)
r = run(undefined, 'edit', { filePath: inScope });
assert.equal(r.ok, true);

// malformed planGate → fail-closed
r = run({ required: 'yes' }, 'edit', { filePath: inScope });
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_INVALID');

// armed + write OUTSIDE surface → still blocked (by the plan gate)
r = run({ required: true, approved: false }, 'edit', { filePath: path.join(root, 'README.md') });
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_ACTIVE');

// bash WRITE command while armed → blocked (terminal bypass closed)
r = run({ required: true, approved: false }, 'bash', { command: 'echo x > out.txt' });
assert.equal(r.ok, false); assert.equal(r.code, 'PLAN_GATE_TERMINAL_BLOCKED');

// bash READ command while armed → allowed (quote-stripping avoids the false positive)
r = run({ required: true, approved: false }, 'bash', { command: "grep 'a>b' file.txt" });
assert.equal(r.ok, true, 'read command must pass');

// bash write while approved → allowed
r = run({ required: true, approved: true }, 'bash', { command: 'echo x > out.txt' });
assert.equal(r.ok, true);

// no activeRun → allow (unchanged behavior)
assert.equal(guardToolExecution({ activeRun: null, toolName: 'edit', args: { filePath: inScope } }).ok, true);

// detectShellWrite unit spot-checks
assert.equal(detectShellWrite('cat file'), false);
assert.equal(detectShellWrite('echo hi > f'), true);
assert.equal(detectShellWrite('node -e "x=1"'), true);
assert.equal(detectShellWrite("grep 'a>b' f"), false);
assert.equal(detectShellWrite('tee f'), true);
assert.equal(detectShellWrite('ls -la'), false);

// adversarial round — false-NEGATIVES that were terminal bypasses (must now be true)
assert.equal(detectShellWrite('echo x 2> src/f.cjs'), true, 'numbered-fd redirect to a file is a write');
assert.equal(detectShellWrite('touch new.cjs'), true);
assert.equal(detectShellWrite('mkdir newdir'), true);
assert.equal(detectShellWrite('curl -o f.cjs http://x'), true);
assert.equal(detectShellWrite('tar -xf p.tar -C src'), true);
assert.equal(detectShellWrite('git checkout -- src/f.cjs'), true);
assert.equal(detectShellWrite('python3 -m py_compile x'), true);
assert.equal(detectShellWrite('rm src/f.cjs'), true);
// fd-dups are NOT writes (no false positive reopened)
assert.equal(detectShellWrite('run 2>&1'), false);
assert.equal(detectShellWrite('cmd >&2'), false);
// verb inside quotes is NOT a false positive (verbs run on the quote-stripped string)
assert.equal(detectShellWrite('echo "cp is a copy command"'), false);

// armed + bash touch → blocked via the guard (terminal bypass closed end-to-end)
let rt = run({ required: true, approved: false }, 'bash', { command: 'touch src/opencode/pwned.cjs' });
assert.equal(rt.ok, false); assert.equal(rt.code, 'PLAN_GATE_TERMINAL_BLOCKED');

// guard must NOT throw on phase.transition with undefined args (fail-closed, not crash)
const rp = guardToolExecution({ activeRun: { allowedSurfaces: [] }, toolName: 'phase.transition', args: undefined });
assert.equal(rp.ok, false);

console.log('plan-gate-guard OK');
