import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer,
  onSnapshot, waitForPendingWrites, terminate } from 'firebase/firestore';

const app=initializeApp({projectId:'demo-firebase-webchannel-probe',apiKey:'fake-api-key',
  authDomain:'localhost'});
const auth=getAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:19099',{disableWarnings:true});
const forced=new URL(location.href).searchParams.get('polling')==='forced';
const db=initializeFirestore(app,forced
  ? {experimentalForceLongPolling:true,experimentalAutoDetectLongPolling:false}
  : {});
connectFirestoreEmulator(db,'127.0.0.1',18080);
let target, unsubscribe;
const state=globalThis.probeState={ready:false,denied:false,serverSnapshot:false,writeAck:false,
  sdkErrors:[],cleanup:false};
const code=error=>typeof error?.code==='string'&&/^[a-z/-]{1,80}$/.test(error.code)
  ? error.code:'other';
const report=error=>state.sdkErrors.push(code(error));
async function setup(){
  const {user}=await signInAnonymously(auth);
  target=doc(db,'probe',user.uid);
  await setDoc(target,{value:0});
  const initial=await getDocFromServer(target);
  if(initial.data()?.value!==0) throw Error('Positive control failed');
  try {await getDocFromServer(doc(db,'probe','another-owner'));}
  catch(error){if(code(error)==='permission-denied')state.denied=true;else throw error;}
  if(!state.denied)throw Error('Negative control failed');
  unsubscribe=onSnapshot(target,{includeMetadataChanges:true},snapshot=>{
    if(!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites)state.serverSnapshot=true;
  },report);
  state.ready=true;
}
globalThis.startProbeWrite=()=>{
  state.writeAck=false;
  void setDoc(target,{value:1}).then(()=>{state.writeAck=true;},report);
};
globalThis.stopProbe=async()=>{
  await waitForPendingWrites(db);
  unsubscribe?.();
  await terminate(db);
  state.cleanup=true;
};
void setup().catch(report);
