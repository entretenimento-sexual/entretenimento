import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const checkNames=['app_install','functions_install','firestore_indexes','app_audit','functions_audit','functions_lint','functions_test','functions_exports','angular_tests','angular_build','firestore_rules','chat_reconciliation','bilateral_block_e2e','media_revocation_e2e','community_interaction_e2e'];
export function resolveQualityGate(env) {
  const checks=checkNames.map(name=>[name,env[name.toUpperCase()]??'missing']);
  // An interrupted run is not a completed validation of this commit.
  // The workflow's own cancelled conclusion remains visible; it cannot
  // overwrite a prior completed commit status. Never publish success for it.
  if(checks.some(([,outcome])=>outcome==='cancelled')) {
    return {state:'cancelled',publishable:false,description:'Quality Gate cancelado; sem publicação agregada.',checks};
  }
  const failed=checks.find(([,outcome])=>outcome!=='success');
  return failed
    ? {state:'failure',publishable:true,description:`Quality Gate falhou em ${failed[0]} (${failed[1]}).`,checks}
    : {state:'success',publishable:true,description:'Todos os checks de qualidade passaram.',checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {state,publishable,description,checks}=resolveQualityGate(process.env);
  for(const [name,outcome] of checks)console.log(name+'='+outcome);
  appendFileSync(process.env.GITHUB_OUTPUT,`state=${state}\npublishable=${publishable}\ndescription=${description}\n`);
}
