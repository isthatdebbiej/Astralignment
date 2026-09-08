import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicySandbox } from '../../gateway/policy';
const valid = `function coordinate(input) { return {commands:[{robot_id:'g1_a',action:'wait'},{robot_id:'g1_b',action:'go',speed:.3}],memory:{count:(input.memory.count||0)+1}} }`;
test('real isolated policy returns validated commands and explicit memory', async () => {
  const sandbox = new PolicySandbox();
  try { const result = await sandbox.call(valid, {memory:{count:4}}); assert.equal(result.memory.count, 5); assert.equal(result.commands[1].speed,.3); } finally { await sandbox.close(); }
});
test('host process and require are unavailable', async () => {
  const sandbox = new PolicySandbox();
  try { await assert.rejects(sandbox.call(`function coordinate() { return process.env; }`, {}), /process/); await assert.rejects(sandbox.call(`function coordinate() { return require('node:fs'); }`, {}), /require/); } finally { await sandbox.close(); }
});
test('infinite loops are interrupted', async () => {
  const sandbox = new PolicySandbox();
  try { await assert.rejects(sandbox.call('function coordinate() { while(true) {} }', {}), /interrupt|timed out/); } finally { await sandbox.close(); }
});
test('rejects duplicate robot commands and out-of-envelope speed', async () => {
  const sandbox = new PolicySandbox();
  try { await assert.rejects(sandbox.call(valid.replace("robot_id:'g1_b'", "robot_id:'g1_a'"), {memory:{}}), /exactly one/); await assert.rejects(sandbox.call(valid.replace('speed:.3','speed:10'), {memory:{}})); } finally { await sandbox.close(); }
});
test('closing before worker startup cancels readiness without a leaked timeout', async () => {
  const sandbox = new PolicySandbox();
  await sandbox.close();
  await assert.rejects(sandbox.call(valid,{memory:{}}),/closed/);
});
