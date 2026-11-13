import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {unzipSync} from 'fflate';

const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'yanhe-update-demo-'));
const extension=join(scratch,'extension'),output=join(root,'test-results');
await cp(join(root,'dist/yanhe-refine-update-inline-test'),extension,{recursive:true});
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
const fixture=`
const demoFetch=fetch.bind(globalThis);
globalThis.fetch=async(resource,options)=>{
 const url=String(resource);
 if(url.startsWith(chrome.runtime.getURL('yanhe-update-probe-'))){
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation');
  return new Response(await (await (await directory.getFileHandle(url.split('/').pop())).getFile()).arrayBuffer());
 }
 return demoFetch(resource,options);
};
globalThis.demoNativeReload=chrome.runtime.reload.bind(chrome.runtime);
chrome.runtime.reload=()=>void chrome.storage.local.set({'fixture:reload':true});
`;
await writeFile(join(extension,'demo-browser-fixture.js'),fixture);
await writeFile(join(extension,'background.js'),"import './demo-browser-fixture.js';\n"+await readFile(join(extension,'background.js'),'utf8'));
let context,page,worker;
const requests=[];
const report={mode:'delivered demonstration package; simulated directory picker and origin-private file writes; real extension reload; all HTTPS requests blocked',checks:[]};
try{
 context=await chromium.launchPersistentContext(join(scratch,'profile'),{
  executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
  ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1300,height:1000}
 });
 context.setDefaultTimeout(30000);
 await context.route('https://**/*',async route=>{requests.push(new URL(route.request().url()).hostname);await route.abort();});
 await context.addInitScript(({manifest})=>{
  if(location.protocol!=='chrome-extension:')return;
  window.showDirectoryPicker=async()=>{
   const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation',{create:true});
   for(const [name,text] of Object.entries({'manifest.json':JSON.stringify(manifest),'background.js':'original background','desk.css':'original style'})){
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
 },{manifest});
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).hostname,url=`chrome-extension://${id}/desk.html#/settings`;
 for(let attempt=0;attempt<100;attempt++){
  page=context.pages().find(tab=>tab.url()===url);
  if(page)break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(page,'The test package should open its settings after installation');
 let update=page.locator('#plugin-update');await update.waitFor();
 assert.equal(await page.getByRole('combobox',{name:'更新演练',exact:true}).count(),0);
 const opened=context.waitForEvent('page');await update.click();const authorization=await opened;
 await authorization.getByRole('button',{name:'选择文件夹并继续',exact:true}).click();
 await page.locator('#update-status').filter({hasText:'正在重新加载'}).waitFor();
 assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('fixture:reload'))['fixture:reload']),true);
 const version=await worker.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('installation');
  return JSON.parse(await (await (await directory.getFileHandle('manifest.json')).getFile()).text()).version;
 });
 assert.equal(version,'1.10.5');assert.deepEqual(requests,[]);
 report.checks.push('the delivered settings perform the bundled 1.10.4-to-1.10.5 update while every HTTPS request is blocked');
 const files=unzipSync(new Uint8Array(await readFile(join(extension,'update-test.zip'))));
 for(const [name,bytes] of Object.entries(files)){
  const target=join(extension,name);assert.ok(target.startsWith(extension+'\\'));
  await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
 }
 const reloaded=context.waitForEvent('serviceworker');
 await worker.evaluate(()=>demoNativeReload()).catch(()=>{});worker=await reloaded;
 for(let attempt=0;attempt<100;attempt++){
  const candidate=context.pages().find(tab=>tab.url()===url&&!tab.isClosed());
  if(candidate&&await candidate.evaluate(()=>chrome.runtime.getManifest().version==='1.10.5').catch(()=>false)){page=candidate;break;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await page.locator('#update-status').filter({hasText:'已更新到 1.10.5'}).waitFor();
 assert.equal(await worker.evaluate(()=>chrome.runtime.getManifest().version_name),'1.10.5-update-test');
 update=page.locator('#plugin-update');await update.click();await page.locator('#update-status').filter({hasText:'已是最新发布版 1.10.5'}).waitFor();
 assert.deepEqual(requests,[]);
 report.checks.push('actual reload confirms 1.10.5-update-test and a second click correctly reports that the demonstration is up to date');
 await page.screenshot({path:join(output,'update-demo-complete.png'),fullPage:true});report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack);process.exitCode=1;await page?.screenshot({path:join(output,'update-demo-failed.png'),fullPage:true}).catch(()=>{});}
finally{
 await context?.close();
 if(dirname(scratch)===resolve(tmpdir())&&basename(scratch).startsWith('yanhe-update-demo-'))await rm(scratch,{recursive:true,force:true});
 await writeFile(join(output,'update-demo-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
