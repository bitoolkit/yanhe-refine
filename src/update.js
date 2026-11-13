import {verifyUpdateDirectory} from './extension-update.js';
import {updateStore} from './extension-update-store.js';

const $=id=>document.getElementById(id),manifest=chrome.runtime.getManifest();
let directory,pending;

async function continueUpdate(){
 const result=await chrome.runtime.sendMessage({type:'REFINE_READ',operation:'resumeUpdate'});
 if(!result?.ok)throw new Error(result?.error||'更新已停止，请在设置中重试。');
 $('description').textContent='已授权，更新完成后自动关闭。';
 $('authorize').hidden=true;
}

$('authorize').onclick=async()=>{
 $('authorize').disabled=true;
 try{
  let selected=directory;
  if(!selected)selected=await window.showDirectoryPicker({id:'yanhe-extension-update',mode:'readwrite'});
  else if(await selected.queryPermission({mode:'readwrite'})!=='granted'&&await selected.requestPermission({mode:'readwrite'})!=='granted'){
   throw new Error('请允许读写插件文件夹。');
  }
  if(!pending)await verifyUpdateDirectory(selected,manifest);
  directory=selected;await updateStore.saveDirectory(directory);
  await continueUpdate();
 }catch(error){
  $('status').textContent=error.name==='AbortError'?'已取消选择，可以重试。':error.message;
  $('authorize').disabled=false;
 }
};

async function init(){
 try{
  [directory,pending]=await Promise.all([updateStore.directory(),updateStore.pending()]);
  if(directory&&await directory.queryPermission({mode:'readwrite'})==='granted'){
   await continueUpdate();return;
  }
  $('description').textContent=directory?`允许读写已保存的文件夹“${directory.name}”，随后自动继续更新。`:'首次更新请选择当前加载的插件文件夹，之后会自动记住。';
  $('authorize').textContent=directory?'授权并继续':'选择文件夹并继续';
  $('authorize').disabled=false;
 }catch(error){$('status').textContent=error.message;}
}
void init();
