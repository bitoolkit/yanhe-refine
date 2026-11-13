import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {updatePackage,downloadUpdate,installUpdate,restoreUpdate,verifyUpdateDirectory} from '../src/extension-update.js';

const encode=value=>strToU8(typeof value==='string'?value:JSON.stringify(value));
const current={manifest_version:3,name:'延河焕新',version:'1.10.4',background:{service_worker:'background.js'}};
const target={...current,version:'1.10.5'};
function archive(extra={},manifest=target){
 return zipSync({'manifest.json':encode(manifest),'background.js':encode('new background'),'update.html':encode('page'),'update.js':encode('code'),'update.css':encode('style'),...extra},{level:0});
}
function fileSystem(initial){
 const files=new Map(Object.entries(initial).map(([path,value])=>[path,encode(value)]));
 let fail=()=>false;
 const directory=prefix=>({
  name:prefix||'extension',
  async getDirectoryHandle(name,{create=false}={}){
   const path=prefix+name+'/';
   if(!create&&![...files.keys()].some(key=>key.startsWith(path)))throw new DOMException('Missing directory','NotFoundError');
   return directory(path);
  },
  async getFileHandle(name,{create=false}={}){
   const path=prefix+name;
   if(!files.has(path)&&!create)throw new DOMException('Missing file','NotFoundError');
   if(!files.has(path))files.set(path,new Uint8Array());
   return {async getFile(){const bytes=files.get(path);return {arrayBuffer:async()=>bytes.slice().buffer};},async createWritable(){
    let written;
    return {write:async bytes=>{written=bytes.slice();},close:async()=>{
     if(fail(path))throw new DOMException('Simulated disk failure','NotAllowedError');
     files.set(path,written);
    },abort:async()=>{}};
   }};
  },
  async removeEntry(name){files.delete(prefix+name);}
 });
 return {directory:directory(''),files,failWrites:callback=>{fail=callback;}};
}
function journal(){
 let pending,backups=[];
 return {pending:async()=>pending,backups:async()=>backups,
  prepare:async(value,files)=>{pending=value;backups=files;},ready:async()=>{pending.phase='ready';},clear:async()=>{pending=undefined;backups=[];}};
}

test('update archives verify file bytes, ownership and version before putting the manifest last',()=>{
 const plan=updatePackage(archive({'folder/new.txt':encode('new')}),current,'1.10.5');
 assert.equal(plan.files.at(-1)[0],'manifest.json');assert.equal(plan.manifest.version,'1.10.5');
 assert.throws(()=>updatePackage(archive(),current,'1.10.4'),/高于/);
 assert.throws(()=>updatePackage(archive({}, {...target,name:'Other'}),current,'1.10.5'),/不匹配/);
 assert.throws(()=>updatePackage(archive({}, {...target,key:'different-id'}),current,'1.10.5'),/不匹配/);
 const missing=archive({'update.js':encode('')});
 assert.throws(()=>updatePackage(missing,current,'1.10.5'),/所需/);
 const damaged=archive({'readme.txt':encode('corruption-target')});
 const index=Buffer.from(damaged).indexOf('corruption-target');damaged[index]^=1;
 assert.throws(()=>updatePackage(damaged,current,'1.10.5'),/损坏/);
});

test('Windows traversal, aliases, case collisions and missing resources are rejected',()=>{
 for(const path of ['../escape.js','/absolute.js','folder\\evil.js','bad:stream','NUL.txt','bad.','x/../bad']){
  assert.throws(()=>updatePackage(archive({[path]:encode('bad')}),current,'1.10.5'),/路径/);
 }
 assert.throws(()=>updatePackage(archive({'UPDATE.js':encode('duplicate')}),current,'1.10.5'),/重复/);
 assert.throws(()=>updatePackage(archive({'a':encode('file'),'a/b':encode('nested')}),current,'1.10.5'),/冲突/);
 assert.throws(()=>updatePackage(zipSync({'manifest.json':encode(target)}),current,'1.10.5'),/所需/);
 assert.throws(()=>updatePackage(new Uint8Array([1,2,3]),current,'1.10.5'),/大小/);
});

test('download uses only the canonical public asset and omits browser credentials',async()=>{
 const update={latestVersion:'1.10.5',downloadUrl:'https://github.com/bitoolkit/yanhe-refine/releases/download/v1.10.5/yanhe-refine-1.10.5.zip'};
 const bytes=archive();
 const result=await downloadUpdate(update,{fetcher:async(url,options)=>{
  assert.equal(url,update.downloadUrl);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  return new Response(bytes,{headers:{'content-length':String(bytes.length)}});
 }});
 assert.deepEqual(result,bytes);
 await assert.rejects(downloadUpdate({...update,downloadUrl:'https://other.invalid/file.zip'}),/地址/);
 await assert.rejects(downloadUpdate(update,{fetcher:async()=>new Response(bytes,{headers:{'content-length':'999999999'}})}),/过大/);
 await assert.rejects(downloadUpdate(update,{fetcher:async()=>new Response(bytes,{headers:{'content-length':'4'}})}),/不完整/);
 await assert.rejects(downloadUpdate(update,{fetcher:async()=>new Response('',{status:403})}),/下载失败/);
});

test('directory selection proves that the selected directory is the loaded extension and removes its probe',async()=>{
 const disk=fileSystem({'manifest.json':current,'background.js':'original'});
 const fetcher=async url=>new Response(disk.files.get(url));
 await verifyUpdateDirectory(disk.directory,current,{getURL:path=>path,fetcher});
 assert.deepEqual([...disk.files.keys()],['manifest.json','background.js']);
 await assert.rejects(verifyUpdateDirectory(disk.directory,current,{getURL:path=>path,fetcher:async()=>new Response('wrong directory')}),/当前加载/);
 assert.deepEqual([...disk.files.keys()],['manifest.json','background.js']);
});

test('successful install keeps an undo journal until the browser confirms its new version',async()=>{
 const disk=fileSystem({'manifest.json':current,'background.js':'original'}),store=journal();
 await installUpdate(disk.directory,updatePackage(archive(),current,'1.10.5'),current,store);
 assert.equal(JSON.parse(new TextDecoder().decode(disk.files.get('manifest.json'))).version,'1.10.5');
 assert.equal((await store.pending()).phase,'ready');assert.equal((await store.backups()).length,5);
 await assert.rejects(installUpdate(disk.directory,updatePackage(archive(),current,'1.10.5'),current,store),/未完成/);
});

test('a partial write failure restores modified files and removes newly created files',async()=>{
 const disk=fileSystem({'manifest.json':current,'background.js':'original'}),store=journal();
 let failed=false;
 disk.failWrites(path=>{if(path==='update.js'&&!failed){failed=true;return true;}return false;});
 await assert.rejects(installUpdate(disk.directory,updatePackage(archive(),current,'1.10.5'),current,store),/已恢复原版本/);
 assert.equal(new TextDecoder().decode(disk.files.get('background.js')),'original');
 assert.deepEqual([...disk.files.keys()],['manifest.json','background.js']);
 assert.equal(await store.pending(),undefined);
});

test('revoked permission retains backups and later recovery restores the original manifest',async()=>{
 const disk=fileSystem({'manifest.json':current,'background.js':'original'}),store=journal();
 let revoked=false;
 disk.failWrites(path=>{if(path==='update.js')revoked=true;return revoked;});
 await assert.rejects(installUpdate(disk.directory,updatePackage(archive(),current,'1.10.5'),current,store),/备份已保留/);
 assert.equal((await store.pending()).phase,'writing');
 disk.failWrites(()=>false);await restoreUpdate(disk.directory,store);
 assert.equal(new TextDecoder().decode(disk.files.get('background.js')),'original');
 assert.equal(JSON.parse(new TextDecoder().decode(disk.files.get('manifest.json'))).version,'1.10.4');
 assert.equal(await store.pending(),undefined);
});

test('backup storage failure leaves every installed file untouched',async()=>{
 const disk=fileSystem({'manifest.json':current,'background.js':'original'}),store=journal();
 store.prepare=async()=>{throw new Error('Quota exceeded');};
 await assert.rejects(installUpdate(disk.directory,updatePackage(archive(),current,'1.10.5'),current,store),/Quota/);
 assert.equal(new TextDecoder().decode(disk.files.get('background.js')),'original');
 assert.deepEqual([...disk.files.keys()],['manifest.json','background.js']);
});
