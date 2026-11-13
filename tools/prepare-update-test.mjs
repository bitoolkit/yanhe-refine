import {build} from 'esbuild';
import {cp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {zipSync,strToU8} from 'fflate';

const root=process.cwd(),output=resolve(root,process.argv[2]||'dist/yanhe-refine-update-inline-test');
const allowed=['dist/yanhe-refine-update-inline-test','dist/yanhe-refine-update-test','test-results/yanhe-refine-update-test'];
if(!allowed.includes(relative(root,output).replaceAll('\\','/')))throw new Error('Unexpected test directory');
await rm(output,{recursive:true,force:true});
const built=JSON.parse(await readFile(join(root,'extension/manifest.json'),'utf8'));
const suffix=built.version_name===built.version+'-dev'?'-dev':'';
await cp(resolve(process.env.EXTENSION_PATH||join(root,'dist','yanhe-refine-'+built.version+suffix)),output,{recursive:true});
const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
manifest.name='延河焕新 · 更新演练';
manifest.action.default_title='打开更新演练';
manifest.version='1.10.4';manifest.version_name='1.10.4-update-test';
manifest.permissions=['storage'];
manifest.host_permissions=['https://api.github.com/*','https://github.com/*','https://release-assets.githubusercontent.com/*'];
delete manifest.content_scripts;delete manifest.web_accessible_resources;
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
const background=`
import {startExtensionUpdate,resumeExtensionUpdate,finishExtensionUpdate,watchUpdateWindows} from ${JSON.stringify(join(root,'src/extension-update-controller.js').replaceAll('\\','/'))};
watchUpdateWindows();
chrome.runtime.onInstalled.addListener(async event=>{
 await finishExtensionUpdate();
 if(event.reason==='install')await chrome.tabs.create({url:chrome.runtime.getURL('desk.html#/settings')});
});
chrome.runtime.onStartup.addListener(()=>void finishExtensionUpdate());
chrome.action.onClicked.addListener(()=>void chrome.tabs.create({url:chrome.runtime.getURL('desk.html#/settings')}));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||message.type!=='REFINE_READ')return;
 let result;
 if(message.operation==='startUpdate')result=startExtensionUpdate(sender);
 else if(message.operation==='resumeUpdate')result=resumeExtensionUpdate(sender);
 else if(message.operation==='catalog')result=Promise.resolve({count:0,modern:0,legacy:0,terms:[],colleges:[]});
 else result=Promise.reject(new Error('更新测试包仅用于更新演练'));
 result.then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));return true;
});
`;
await build({stdin:{contents:background,resolveDir:root,loader:'js'},outfile:join(output,'background.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120'});
const fixture=`
const fixtureFetch=globalThis.fetch.bind(globalThis);
const fixtureDownload='https://github.com/bitoolkit/yanhe-refine/releases/download/v1.10.5/yanhe-refine-1.10.5.zip';
let fixtureFailed=false,fixturePrevious;
const fixtureWritable=FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable=async function(...args){
 const scenario=(await chrome.storage.local.get('fixture:scenario'))['fixture:scenario']||'normal';
 if(scenario!==fixturePrevious){fixtureFailed=false;fixturePrevious=scenario;}
 if((scenario==='permission'||scenario==='write'&&!fixtureFailed)&&this.name==='desk.css'){
  fixtureFailed=true;throw new DOMException('模拟写入失败','NotAllowedError');
 }
 return fixtureWritable.apply(this,args);
};
globalThis.fetch=async(resource,options)=>{
 const url=String(resource);
 if(url==='https://api.github.com/repos/bitoolkit/yanhe-refine/releases/latest'){
  return Response.json({tag_name:'v1.10.5',draft:false,prerelease:false,assets:[{name:'yanhe-refine-1.10.5.zip',state:'uploaded',browser_download_url:fixtureDownload}]});
 }
 if(url===fixtureDownload){
  const scenario=(await chrome.storage.local.get('fixture:scenario'))['fixture:scenario']||'normal';
  if(scenario==='offline')throw new TypeError('模拟下载断网');
  const bytes=scenario==='broken'?new Uint8Array([1,2,3]):new Uint8Array(await (await fixtureFetch(chrome.runtime.getURL('update-test.zip'))).arrayBuffer());
  return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
 }
 return fixtureFetch(resource,options);
};
`;
await writeFile(join(output,'update-test-fixture.js'),fixture);
await writeFile(join(output,'background.js'),"import './update-test-fixture.js';\n"+await readFile(join(output,'background.js'),'utf8'));
const files={};
async function collect(folder){
 for(const entry of await readdir(folder,{withFileTypes:true})){
  const path=join(folder,entry.name);
  if(entry.isDirectory())await collect(path);
  else files[relative(output,path).replaceAll('\\','/')]=new Uint8Array(await readFile(path));
 }
}
await collect(output);
files['manifest.json']=strToU8(JSON.stringify({...manifest,version:'1.10.5',version_name:'1.10.5-update-test'},null,2));
files['build-info.json']=strToU8(JSON.stringify({version:'1.10.5',catalog:null}));
files['added-by-update.txt']=strToU8('更新测试新增文件\n');
await writeFile(join(output,'update-test.zip'),zipSync(files,{level:6}));
console.log(JSON.stringify({directory:output,from:manifest.version,to:'1.10.5',entry:'desk.html#/settings',fixture:'bundled synthetic update'}));
