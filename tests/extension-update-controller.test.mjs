import test from 'node:test';
import assert from 'node:assert/strict';
import {updateStore} from '../src/extension-update-store.js';

let instance=0;
async function controller(t,{stage='downloading',pending,job,windowExists=false}={}){
 const originalChrome=globalThis.chrome,originalStore={...updateStore};
 const local={'desk:update-status':{stage,text:'Interrupted',version:'1.10.4'}},session={'desk:update-job':job},closed=[];
 const storage=values=>({get:async key=>({[key]:values[key]}),set:async value=>Object.assign(values,value),remove:async key=>delete values[key]});
 globalThis.chrome={
  runtime:{getManifest:()=>({version:'1.10.4'}),getURL:path=>'chrome-extension://fixture/'+path},
  storage:{local:storage(local),session:storage(session)},
  windows:{get:async id=>{if(!windowExists)throw Error('window missing');return {id};},remove:async id=>closed.push(id)}
 };
 Object.assign(updateStore,{complete:async()=>false,pending:async()=>pending});
 t.after(()=>{globalThis.chrome=originalChrome;Object.assign(updateStore,originalStore);});
 const module=await import('../src/extension-update-controller.js?test='+instance++);
 return {module,local,session,closed};
}

test('a newly awakened worker recovers stale busy status without a browser restart',async t=>{
 const state=await controller(t);
 await state.module.initializeExtensionUpdate();
 assert.equal(state.local['desk:update-status'].stage,'idle');
 state.local['desk:update-status'].stage='installing';
 assert.equal((await state.module.extensionUpdateStatus()).stage,'idle');
});

test('authorization remains available when its real popup survives worker suspension',async t=>{
 const state=await controller(t,{stage:'authorize',job:{windowId:9},windowExists:true});
 assert.equal((await state.module.extensionUpdateStatus()).stage,'authorize');
 assert.equal(state.session['desk:update-job'].windowId,9);assert.deepEqual(state.closed,[]);
});

test('an interrupted write keeps its journal and exposes recovery instead of a disabled busy button',async t=>{
 const state=await controller(t,{pending:{phase:'writing',from:'1.10.4',to:'1.10.5'},job:{windowId:9,authorized:true}});
 const status=await state.module.extensionUpdateStatus();
 assert.equal(status.stage,'recover');assert.match(status.text,/恢复原版本/);
 assert.deepEqual(state.closed,[9]);assert.equal(state.session['desk:update-job'],undefined);
});

test('a transient update storage failure leaves initialization retryable',async t=>{
 const state=await controller(t);let fail=true;
 updateStore.complete=async()=>{if(fail){fail=false;throw Error('temporary storage failure');}return false;};
 await assert.rejects(state.module.initializeExtensionUpdate(),/temporary storage/);
 await state.module.initializeExtensionUpdate();assert.equal(state.local['desk:update-status'].stage,'idle');
});
