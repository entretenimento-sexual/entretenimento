import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNames, resolveQualityGate } from './resolve-quality-gate.mjs';
const success=()=>Object.fromEntries(checkNames.map(name=>[name.toUpperCase(),'success']));
test('publishes success only when all required stages pass',()=>{
  const result=resolveQualityGate(success());
  assert.equal(result.state,'success');assert.equal(result.publishable,true);assert.equal(result.checks.length,15);
});
test('publishes a completed actual failure',()=>{
  const result=resolveQualityGate({...success(),ANGULAR_TESTS:'failure'});
  assert.equal(result.state,'failure');assert.equal(result.publishable,true);
});
test('cancelled run never replaces a completed status even with earlier failure or skipped stages',()=>{
  for(const env of [{...success(),APP_INSTALL:'cancelled'},{...success(),APP_INSTALL:'failure',ANGULAR_TESTS:'cancelled',ANGULAR_BUILD:'skipped'}]){
    const result=resolveQualityGate(env);assert.equal(result.state,'cancelled');assert.equal(result.publishable,false);
  }
});
test('missing or skipped required checks fail closed',()=>{
  for(const outcome of [undefined,'skipped','unexpected']){
    const result=resolveQualityGate({...success(),FIRESTORE_RULES:outcome});
    assert.equal(result.state,'failure');assert.equal(result.publishable,true);
  }
});
