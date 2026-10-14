import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOrphanFirestore } from '../dev/orphan-firestore-stop.policy.mjs';

const safe = {
  owner: {
    count: 1, pid: 37532, name: 'java.exe', parentAlive: false,
    commandLine: 'java -jar C:\\cache\\cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8080 --project_id entretenimento-sexual --seed_from_export C:\\entretenimento\\.emulator-data\\firestore_export\\firestore_export.overall_export_metadata --rules C:\\entretenimento\\firestore.rules',
  },
  hubOccupied: false, otherPorts: [],
  projectRoot: 'C:\\entretenimento', projectId: 'entretenimento-sexual',
};

test('identifies only the specific Firestore orphan from this project and snapshot', () => {
  assert.equal(assessOrphanFirestore(safe), null);
});

for (const [label, mutate] of [
  ['active Hub', { hubOccupied: true }],
  ['other emulator process', { otherPorts: [5001] }],
  ['parent still alive', { owner: { ...safe.owner, parentAlive: true } }],
  ['unknown executable', { owner: { ...safe.owner, name: 'node.exe' } }],
  ['PID missing', { owner: { ...safe.owner, pid: 0 } }],
  ['different project', { projectId: 'other-project' }],
  ['different rules path', { projectRoot: 'C:\\another-project' }],
  ['another Firestore port', { owner: { ...safe.owner, commandLine: safe.owner.commandLine.replace('--port 8080', '--port 8081') } }],
  ['missing import path', { owner: { ...safe.owner, commandLine: safe.owner.commandLine.replace('firestore_export', 'other_export') } }],
]) {
  test('refuses to stop: ' + label, () => {
    assert.notEqual(assessOrphanFirestore({ ...safe, ...mutate }), null);
  });
}
