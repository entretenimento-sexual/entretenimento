import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

// Only mutate the disposable CI checkout, never a developer snapshot.
assert.equal(process.env.CI, 'true');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
const path = 'src/environments/environment.dev-emu.ts';
let source = readFileSync(path, 'utf8');
function replaceOnce(before, after) {
  assert.equal(source.split(before).length, 2, 'Unexpected dev-emu topology: ' + before);
  source = source.replace(before, after);
}
replaceOnce("projectId: 'entretenimento-sexual'", "projectId: 'demo-entretenimento-media-e2e'");
replaceOnce("storageBucket: 'entretenimento-sexual.appspot.com'", "storageBucket: 'demo-entretenimento-media-e2e.appspot.com'");
for (const [from, to] of [[9099,19099],[8080,18080],[9199,19199],[5001,15001],[9000,19000]]) {
  replaceOnce('port: ' + from, 'port: ' + to);
}
assert.match(source, /useEmulators: true/);
assert.match(source, /production: false/);
writeFileSync(path, source);
const config = JSON.parse(readFileSync('firebase.media-e2e.json', 'utf8'));
config.emulators.database = { host: '127.0.0.1', port: 19000 };
// No RTDB social authority is tested here. Default deny for this disposable
// service; the canonical Firestore and Storage rules remain untouched.
config.database = { rules: 'database.chat-browser-ci.rules.json' };
writeFileSync('database.chat-browser-ci.rules.json', JSON.stringify({rules:{'.read':false,'.write':false}}));
writeFileSync('firebase.chat-browser-ci.json', JSON.stringify(config, null, 2));
console.log('Disposable browser topology prepared; no production endpoints or imported data.');
