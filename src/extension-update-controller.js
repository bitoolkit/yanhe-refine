import {checkForUpdate,UPDATE_STATUS} from './update-check.js';
import {downloadUpdate,updatePackage,verifyUpdateDirectory,installUpdate,restoreUpdate} from './extension-update.js';
import {updateStore} from './extension-update-store.js';

const UPDATE_JOB='desk:update-job';
const UPDATE_RETURN='desk:update-return';
let flight,statusWrite=Promise.resolve();

function status(stage,text,details={}){
 const value={stage,text,version:chrome.runtime.getManifest().version,...details};
 statusWrite=statusWrite.catch(()=>{}).then(()=>chrome.storage.local.set({[UPDATE_STATUS]:value}));
 return statusWrite;
}

function settingsTab(sender){
 if(!sender?.tab?.id)return null;
 try{
  const url=new URL(sender.url);
  if(url.searchParams.get('yh_view')!=='settings'&&!url.hash.startsWith('#/settings'))return null;
  const extensionPage=url.protocol==='chrome-extension:'&&url.hostname===chrome.runtime.id&&url.pathname==='/desk.html';
  return {id:sender.tab.id,origin:url.origin,windowId:sender.tab.windowId,extensionPage};
 }catch{return null;}
}

async function authorize(job){
 const existing=(await chrome.storage.session.get(UPDATE_JOB))[UPDATE_JOB];
 if(existing?.windowId){
  try{await chrome.windows.update(existing.windowId,{focused:true});return;}catch{}
 }
 await chrome.storage.session.set({[UPDATE_JOB]:job});
 await status('authorize','请在授权窗口中允许更新。');
 const popup=await chrome.windows.create({url:chrome.runtime.getURL('update.html'),type:'popup',width:440,height:290,focused:true});
 await chrome.storage.session.set({[UPDATE_JOB]:{...job,windowId:popup.id}});
}

async function closeAuthorization(job){
 await chrome.storage.session.remove(UPDATE_JOB);
 if(job.windowId)void chrome.windows.remove(job.windowId).catch(()=>{});
}

function progress(stage,label){
 let last=0;
 return (done,total)=>{
  const now=Date.now();
  if(now-last<200&&done!==total)return;
  last=now;
  void status(stage,label,{done,total}).catch(()=>{});
 };
}

async function run(job){
 await navigator.locks.request('yanhe-extension-update',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error('另一个窗口正在更新，请稍候。');
  const manifest=chrome.runtime.getManifest(),pending=await updateStore.pending();
  let update;
  if(!pending){
   await status('checking','正在检查更新…');
   update=await checkForUpdate(manifest.version);
   if(!update.available){
    await status('idle',update.ahead?'当前版本高于最新发布版 '+update.latestVersion:'已是最新发布版 '+update.latestVersion);
    await closeAuthorization(job);
    return;
   }
   if(!update.downloadUrl)throw new Error('新版安装包暂未就绪，请稍后重试。');
  }
  const directory=await updateStore.directory();
  if(!directory||await directory.queryPermission({mode:'readwrite'})!=='granted'){
   await authorize(job);return;
  }
  if(pending?.phase==='writing'){
   await status('restoring','正在恢复原版本…');
   await restoreUpdate(directory,updateStore,progress('restoring','正在恢复原版本…'));
   await status('idle','已恢复原版本，正在重新加载…');
  }else{
   if(!pending){
    try{await verifyUpdateDirectory(directory,manifest);}
    catch{await updateStore.saveDirectory(null);await authorize(job);return;}
    const bytes=await downloadUpdate(update,{signal:AbortSignal.timeout(180000),onProgress:progress('downloading','正在下载更新…')});
    await status('installing','正在安装更新…');
    const plan=updatePackage(bytes,manifest,update.latestVersion);
    await installUpdate(directory,plan,{...manifest,returnTab:job.returnTab},updateStore,progress('installing','正在安装更新…'));
   }
   await status('reloading','更新完成，正在重新加载…');
  }
  await closeAuthorization(job);
  await chrome.storage.local.set({[UPDATE_RETURN]:job.returnTab});
  chrome.runtime.reload();
 });
}

function launch(job){
 if(flight)return;
 flight=run(job).catch(async error=>{
  const pending=await updateStore.pending();
  await status(pending?'recover':'error',error.message||'更新失败，请重试。');
  await closeAuthorization(job);
 }).finally(()=>{flight=null;});
}

export async function startExtensionUpdate(sender){
 if(flight)await flight;
 const saved=(await chrome.storage.session.get(UPDATE_JOB))[UPDATE_JOB];
 if(saved?.windowId){
  try{await chrome.windows.update(saved.windowId,{focused:true});return true;}catch{}
 }
 launch({returnTab:settingsTab(sender)});
 return true;
}

export async function resumeExtensionUpdate(sender){
 if(sender?.url!==chrome.runtime.getURL('update.html'))throw new Error('更新授权来源无效');
 if(flight)await flight;
 const job=(await chrome.storage.session.get(UPDATE_JOB))[UPDATE_JOB];
 if(!job)throw new Error('更新已取消，请在设置中重试。');
 await chrome.storage.session.set({[UPDATE_JOB]:{...job,authorized:true}});
 // Keep an extension document alive until all authorized file writes finish.
 launch({...job,authorized:true});
 return true;
}

export async function finishExtensionUpdate(){
 const completed=await updateStore.complete(chrome.runtime.getManifest().version);
 const pending=await updateStore.pending();
 let returnTab=(await chrome.storage.local.get(UPDATE_RETURN))[UPDATE_RETURN];
 if(completed){
  const receipt=await updateStore.receipt();
  await status('complete','已更新到 '+receipt.to+'。');
  returnTab||=receipt.returnTab;
 }else if(pending)await status('recover',pending.phase==='ready'?'更新已准备好，点击完成更新。':'上次更新中断，点击恢复原版本。');
 else if(returnTab)await status('idle','已恢复原版本。');
 else{
  const saved=(await chrome.storage.local.get(UPDATE_STATUS))[UPDATE_STATUS];
  if(saved&&['checking','authorize','downloading','installing','restoring','reloading'].includes(saved.stage))await status('idle','上次更新已停止，可以重试。');
 }
 await chrome.storage.session.remove(UPDATE_JOB);
 if(!pending){
  await chrome.storage.local.remove(UPDATE_RETURN);
  if(returnTab){
   const tab=await chrome.tabs.get(returnTab.id).catch(()=>null);
   if(tab&&settingsTab({tab,url:tab.url})?.origin===returnTab.origin)await chrome.tabs.reload(tab.id);
   else if(!tab&&returnTab.extensionPage)await chrome.tabs.create({url:chrome.runtime.getURL('desk.html#/settings')});
  }
 }
}

export function watchUpdateWindows(){
 chrome.windows.onRemoved.addListener(async id=>{
  const job=(await chrome.storage.session.get(UPDATE_JOB))[UPDATE_JOB];
  if(job?.windowId!==id)return;
  if(job.authorized)return;
  await chrome.storage.session.remove(UPDATE_JOB);
  await status('idle','已取消更新，可再次点击“一键更新”。');
 });
}
