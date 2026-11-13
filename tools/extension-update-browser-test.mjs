import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename,relative} from 'node:path';
import {chromium} from 'playwright';
import {zipSync,strToU8} from 'fflate';
import {installSignedOutRecoveryFixture} from './signed-out-recovery-fixture.mjs';

const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'yanhe-inline-update-'));
const extension=join(scratch,'extension'),output=join(root,'test-results');
const built=JSON.parse(await readFile(join(root,'extension/manifest.json'),'utf8'));
const suffix=built.version_name===built.version+'-dev'?'-dev':'';
await cp(resolve(process.env.EXTENSION_PATH||join(root,'dist','yanhe-refine-'+built.version+suffix)),extension,{recursive:true});
await mkdir(output,{recursive:true});
await writeFile(join(extension,'build-info.json'),JSON.stringify({version:'1.10.4',catalog:null}));
await writeFile(join(extension,'bundled-catalogs.json'),JSON.stringify({schema:1,catalogs:{}}));
await installSignedOutRecoveryFixture(extension);
const before=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
const backgroundFixture=`
const inlineFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(resource,options)=>{
 const url=String(resource);
 if(url.startsWith(chrome.runtime.getURL('yanhe-update-probe-'))){
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation');
  return new Response(await (await (await directory.getFileHandle(url.split('/').pop())).getFile()).arrayBuffer());
 }
 return inlineFetch(resource,options);
};
const inlineQuery=FileSystemDirectoryHandle.prototype.queryPermission;
FileSystemDirectoryHandle.prototype.queryPermission=async function(options){
 if((await chrome.storage.local.get('fixture:permission'))['fixture:permission']==='prompt')return 'prompt';
 return inlineQuery.call(this,options);
};
const inlineWritable=FileSystemFileHandle.prototype.createWritable;
let inlineFailed=false;
FileSystemFileHandle.prototype.createWritable=async function(...args){
 const scenario=(await chrome.storage.local.get('fixture:scenario'))['fixture:scenario'];
 if(scenario==='write'&&!inlineFailed&&this.name==='desk.css'){
  inlineFailed=true;throw new DOMException('模拟写入失败','NotAllowedError');
 }
 return inlineWritable.apply(this,args);
};
globalThis.inlineNativeReload=chrome.runtime.reload.bind(chrome.runtime);
chrome.runtime.reload=()=>void chrome.storage.local.set({'fixture:reload':true});
`;
await writeFile(join(extension,'inline-update-fixture.js'),backgroundFixture);
await writeFile(join(extension,'background.js'),"import './inline-update-fixture.js';\n"+await readFile(join(extension,'background.js'),'utf8'));
const files={};
async function collect(folder){
 for(const entry of await readdir(folder,{withFileTypes:true})){
  const path=join(folder,entry.name);
  if(entry.isDirectory())await collect(path);
  else files[relative(extension,path).replaceAll('\\','/')]=new Uint8Array(await readFile(path));
 }
}
await collect(extension);
files['manifest.json']=strToU8(JSON.stringify({...before,version:'1.10.5',version_name:'1.10.5-dev'}));
files['build-info.json']=strToU8(JSON.stringify({version:'1.10.5',catalog:null}));
files['added-by-update.txt']=strToU8('new file');
const bytes=zipSync(files,{level:6});
const report={mode:'isolated Edge; synthetic network and directory authorization with origin-private file writes; actual extension reload',checks:[]};
let context,page,worker;
const errors=[];
async function waitStatus(text){await page.locator('#update-status').filter({hasText:text}).waitFor();}
async function local(key){return worker.evaluate(async key=>(await chrome.storage.local.get(key))[key],key);}
try{
 context=await chromium.launchPersistentContext(join(scratch,'profile'),{
  executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
  ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1440,height:1000}
 });
 context.setDefaultTimeout(30000);
 await context.addInitScript(({before})=>{
  if(location.protocol!=='chrome-extension:')return;
  window.showDirectoryPicker=async()=>{
   const count=(await chrome.storage.local.get('fixture:pickers'))['fixture:pickers']||0;
   await chrome.storage.local.set({'fixture:pickers':count+1});
   const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation',{create:true});
   try{await directory.getFileHandle('manifest.json');return directory;}catch{}
   for(const [name,text] of Object.entries({'manifest.json':JSON.stringify(before),'background.js':'original background','build-info.json':'original build','desk.css':'original style'})){
    const file=await directory.getFileHandle(name,{create:true}),stream=await file.createWritable();await stream.write(text);await stream.close();
   }
   return directory;
  };
  const nativeFetch=fetch.bind(globalThis);
  globalThis.fetch=async(resource,options)=>{
   const url=String(resource);
   if(url.startsWith(chrome.runtime.getURL('yanhe-update-probe-'))){
    const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation');
    return new Response(await (await (await directory.getFileHandle(url.split('/').pop())).getFile()).arrayBuffer());
   }
   return nativeFetch(resource,options);
  };
  const originalQuery=FileSystemDirectoryHandle.prototype.queryPermission;
  FileSystemDirectoryHandle.prototype.queryPermission=async function(options){
   if((await chrome.storage.local.get('fixture:permission'))['fixture:permission']==='prompt')return 'prompt';
   return originalQuery.call(this,options);
  };
  FileSystemDirectoryHandle.prototype.requestPermission=async()=>{
   await chrome.storage.local.remove('fixture:permission');return 'granted';
  };
 },{before});
 let downloadMode='offline',requests=0;
 context.on('page',tab=>tab.on('pageerror',error=>errors.push(error.message)));
 await context.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET');
  const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(url.hostname==='api.github.com'){
   requests++;return json({tag_name:'v1.10.5',draft:false,prerelease:false,assets:[{name:'yanhe-refine-1.10.5.zip',state:'uploaded',browser_download_url:'https://github.com/bitoolkit/yanhe-refine/releases/download/v1.10.5/yanhe-refine-1.10.5.zip'}]});
  }
  if(url.hostname==='github.com')return downloadMode==='offline'?route.abort():route.fulfill({body:Buffer.from(bytes),contentType:'application/zip'});
  if(url.hostname==='aita.yanhekt.cn'&&url.pathname.endsWith('infosimple'))return json({code:200,params:{id:7,tenant_id:21,account:'fixture'}});
  if(url.hostname==='aita.yanhekt.cn'&&url.pathname.endsWith('/account-profile/course'))return json({code:1000,params:{result:{data:[],total:0}}});
  if(url.hostname==='zy-eclass.bit.edu.cn')return json({courses:[]});
  if(url.hostname==='lexue.bit.edu.cn'||url.hostname==='cbiz.yanhekt.cn')return route.fulfill({status:401,body:''});
  if(url.hostname==='aita.yanhekt.cn')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Native fixture</body></html>'});
  throw Error('Unexpected network request '+url.hostname);
 });
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 page=await context.newPage();const url='https://aita.yanhekt.cn/personal/?yh_view=settings';await page.goto(url);
 const update=page.locator('#plugin-update');await update.waitFor();
 assert.equal(requests,0);assert.equal(await page.getByRole('button',{name:'检查更新',exact:true}).count(),0);
 const tabCount=context.pages().length;
 const opened=context.waitForEvent('page');await update.click();const popup=await opened;
 await popup.getByRole('button',{name:'选择文件夹并继续',exact:true}).waitFor();
 assert.equal(await popup.getByRole('button').count(),1);
 const popupWindow=await popup.evaluate(()=>chrome.windows.getCurrent());assert.equal(popupWindow.type,'popup');
 await popup.setViewportSize({width:420,height:240});
 assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:join(output,'inline-update-settings.png'),fullPage:true});
 await popup.screenshot({path:join(output,'inline-update-authorization.png'),fullPage:true});
 await popup.close();await waitStatus('已取消更新');assert.equal(page.url(),url);
 report.checks.push('one settings button starts the flow; authorization uses one button in a compact popup, and closing it makes the original settings retryable');
 const reopened=context.waitForEvent('page');await update.click();const authorization=await reopened;
 const authorizedClosed=authorization.waitForEvent('close');
 await authorization.getByRole('button',{name:'选择文件夹并继续',exact:true}).click();
 await authorizedClosed;await waitStatus('下载失败');
 assert.equal(context.pages().length,tabCount);assert.equal(page.url(),url);
 report.checks.push('directory selection closes the authorization window automatically, with download errors displayed in the original settings');
 await worker.evaluate(()=>chrome.storage.local.set({'fixture:permission':'prompt'}));
 const reauthorizing=context.waitForEvent('page');await update.click();const reauthorize=await reauthorizing;
 const reauthorizedClosed=reauthorize.waitForEvent('close');
 await reauthorize.getByRole('button',{name:'授权并继续',exact:true}).click();await reauthorizedClosed;
 await waitStatus('下载失败');assert.equal(await local('fixture:pickers'),1);
 report.checks.push('expired permission reuses the stored directory and returns directly to the same settings');
 downloadMode='normal';await worker.evaluate(()=>chrome.storage.local.set({'fixture:scenario':'write'}));
 await update.click();await waitStatus('已恢复原版本');assert.equal(context.pages().length,tabCount);
 await worker.evaluate(()=>chrome.storage.local.set({'fixture:scenario':'normal','desk:favorites':['modern:21:123'],'progress:123:4':{time:321,view:'screen'}}));
 await update.click();await waitStatus('正在重新加载');
 assert.equal(context.pages().length,tabCount);
 assert.equal(await local('fixture:reload'),true);
 const written=await worker.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation');
  return JSON.parse(await (await (await directory.getFileHandle('manifest.json')).getFile()).text()).version;
 });assert.equal(written,'1.10.5');
 report.checks.push('with permission already granted, writing, rollback and retry all run from the settings button without any extra window or tab');
 for(const [name,file] of Object.entries(files)){
  const path=join(extension,name);assert.ok(path.startsWith(extension+'\\'));await mkdir(dirname(path),{recursive:true});await writeFile(path,file);
 }
 const newWorker=context.waitForEvent('serviceworker');
 await worker.evaluate(()=>inlineNativeReload()).catch(()=>{});worker=await newWorker;
 await waitStatus('已更新到 1.10.5');assert.equal(page.url(),url);assert.equal(context.pages().length,tabCount);
 assert.deepEqual(await local('desk:favorites'),['modern:21:123']);assert.equal((await local('progress:123:4')).time,321);
 await page.setViewportSize({width:375,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:join(output,'inline-update-complete.png'),fullPage:true});
 report.checks.push('actual reload confirms the new version, refreshes the initiating settings tab in place and preserves records; narrow settings remain within the viewport');
 assert.deepEqual(errors,[]);report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack);report.status=await page?.locator('#update-status').textContent().catch(()=>null);report.background=await worker?.evaluate(()=>chrome.storage.local.get(['desk:update-status','fixture:permission','fixture:scenario'])).catch(()=>null);process.exitCode=1;await page?.screenshot({path:join(output,'inline-update-failed.png'),fullPage:true}).catch(()=>{});}
finally{
 await context?.close();
 if(dirname(scratch)===resolve(tmpdir())&&basename(scratch).startsWith('yanhe-inline-update-'))await rm(scratch,{recursive:true,force:true});
 await writeFile(join(output,'extension-update-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
