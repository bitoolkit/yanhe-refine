import {unzipSync} from 'fflate';
import {compareVersions,RELEASE_REPO} from './update-check.js';

export const MAX_UPDATE_BYTES=64*1024*1024;
const MAX_CONTENT_BYTES=256*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,value)=>{
 for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;
 return value>>>0;
});

export function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}

function safePath(path){
 const parts=path.replace(/\/$/,'').split('/');
 if(!path||path.includes('\\')||parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\x7f<>:"|?*]/.test(part)||/[ .]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))){
  throw new Error('更新包包含无效文件路径');
 }
 return parts.join('/').normalize('NFC').toLowerCase();
}

function zipEntries(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=bytes.length-22;
 const earliest=Math.max(0,end-65535);
 while(end>=earliest&&(view.getUint32(end,true)!==0x06054b50||end+22+view.getUint16(end+20,true)!==bytes.length))end--;
 if(end<earliest)throw new Error('更新包不是完整的 ZIP 文件');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
 if(view.getUint32(end+4,true)!==0||view.getUint16(end+8,true)!==count||!count||count>4096||start+size!==end){
  throw new Error('更新包目录格式不受支持');
 }
 const entries=[],names=new Map();
 let offset=start,total=0;
 for(let index=0;index<count;index++){
  if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw new Error('更新包目录损坏');
  const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true);
  const length=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
  const compressed=view.getUint32(offset+20,true),original=view.getUint32(offset+24,true),local=view.getUint32(offset+42,true);
  const next=offset+46+length+extra+comment;
  if(next>end||local+30>start||flags&1||![0,8].includes(method)||original>MAX_UPDATE_BYTES||view.getUint16(offset+34,true)!==0){
   throw new Error('更新包文件格式不受支持');
  }
  const encoded=bytes.subarray(offset+46,offset+46+length);
  if(!(flags&2048)&&encoded.some(byte=>byte>127))throw new Error('更新包文件名编码无效');
  const name=decoder.decode(encoded),key=safePath(name),directory=name.endsWith('/');
  if(names.has(key)||(view.getUint32(offset+38,true)>>>16&0xf000)===0xa000)throw new Error('更新包存在重复文件或链接');
  if(view.getUint32(local,true)!==0x04034b50||view.getUint16(local+8,true)!==method||view.getUint16(local+6,true)!==flags){
   throw new Error('更新包文件头损坏');
  }
  const localLength=view.getUint16(local+26,true),dataStart=local+30+localLength+view.getUint16(local+28,true);
  if(dataStart+compressed>start||decoder.decode(bytes.subarray(local+30,local+30+localLength))!==name){
   throw new Error('更新包文件范围无效');
  }
  total+=original;
  if(total>MAX_CONTENT_BYTES)throw new Error('更新包解压内容过大');
  names.set(key,directory);
  entries.push({name,key,directory,size:original,crc:view.getUint32(offset+16,true)});
  offset=next;
 }
 if(offset!==end)throw new Error('更新包目录不完整');
 for(const entry of entries){
  const parts=entry.key.split('/');parts.pop();
  while(parts.length){
   if(names.get(parts.join('/'))===false)throw new Error('更新包文件路径冲突');
   parts.pop();
  }
 }
 return entries;
}

export function updatePackage(bytes,current,expectedVersion){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_UPDATE_BYTES)throw new Error('更新包大小无效');
 if(compareVersions(expectedVersion,current.version)<=0)throw new Error('更新版本需要高于当前版本');
 const entries=zipEntries(bytes);
 const files=unzipSync(bytes,{filter:entry=>!entry.name.endsWith('/')});
 const content=new Map();
 for(const entry of entries){
  if(entry.directory)continue;
  const file=files[entry.name];
  if(!file||file.length!==entry.size||crc32(file)!==entry.crc)throw new Error('更新包内容损坏，请重新下载');
  content.set(entry.name,file);
 }
 let manifest;
 try{manifest=JSON.parse(decoder.decode(content.get('manifest.json')));}catch{throw new Error('更新包缺少有效插件清单');}
 if(manifest.version!==expectedVersion||manifest.manifest_version!==current.manifest_version||manifest.name!==current.name||manifest.key!==current.key){
  throw new Error('更新包的插件或版本不匹配');
 }
 const required=['update.html','update.js','update.css'];
 if(manifest.background?.service_worker)required.push(manifest.background.service_worker);
 for(const script of manifest.content_scripts||[])required.push(...script.js||[],...script.css||[]);
 for(const icon of Object.values(manifest.icons||{}))required.push(icon);
 if(required.some(path=>!content.get(path)?.length))throw new Error('更新包缺少插件所需文件');
 // Commit the manifest after every other resource has been written and verified.
 const ordered=[...content].filter(([path])=>path!=='manifest.json');
 ordered.push(['manifest.json',content.get('manifest.json')]);
 return {manifest,files:ordered};
}

export async function downloadUpdate(update,{fetcher=fetch,onProgress=()=>{},signal}={}){
 const prefix=RELEASE_REPO+'/releases/download/v'+update.latestVersion+'/';
 if(!update.downloadUrl?.startsWith(prefix)||!/^yanhe-refine-[\d.]+(?:-\d{8})?\.zip$/.test(update.downloadUrl.slice(prefix.length))){
  throw new Error('更新下载地址无效');
 }
 let response;
 try{response=await fetcher(update.downloadUrl,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});}
 catch{throw new Error('更新包下载失败，请重试');}
 if(!response.ok)throw new Error('更新包下载失败，请重试');
 if(response.url){
  const destination=new URL(response.url);
  if(destination.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com'].includes(destination.hostname))throw new Error('更新下载来源无效');
 }
 const total=Number(response.headers.get('content-length'))||0;
 if(total>MAX_UPDATE_BYTES)throw new Error('更新包过大');
 const chunks=[];
 let received=0;
 const reader=response.body.getReader();
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   received+=value.length;
   if(received>MAX_UPDATE_BYTES)throw new Error('更新包过大');
   chunks.push(value);onProgress(received,total);
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 if(total&&received!==total)throw new Error('更新包下载不完整');
 const bytes=new Uint8Array(received);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return bytes;
}

async function fileHandle(directory,path,create=false){
 const parts=path.split('/'),name=parts.pop();
 for(const part of parts)directory=await directory.getDirectoryHandle(part,{create});
 return directory.getFileHandle(name,{create});
}

async function readFile(directory,path){
 try{return new Uint8Array(await (await (await fileHandle(directory,path)).getFile()).arrayBuffer());}
 catch(error){if(error.name==='NotFoundError')return null;throw error;}
}

async function writeFile(directory,path,bytes){
 const handle=await fileHandle(directory,path,true),stream=await handle.createWritable();
 try{await stream.write(bytes);await stream.close();}
 catch(error){await stream.abort().catch(()=>{});throw error;}
 const written=await readFile(directory,path);
 if(written.length!==bytes.length||crc32(written)!==crc32(bytes))throw new Error('文件写入未完成');
}

async function removeFile(directory,path){
 const parts=path.split('/'),name=parts.pop();
 try{
  for(const part of parts)directory=await directory.getDirectoryHandle(part);
  await directory.removeEntry(name);
 }catch(error){if(error.name!=='NotFoundError')throw error;}
}

export async function verifyUpdateDirectory(directory,current,{fetcher=fetch,getURL=path=>chrome.runtime.getURL(path)}={}){
 let manifest;
 try{manifest=JSON.parse(decoder.decode(await readFile(directory,'manifest.json')));}catch{throw new Error('请选择含 manifest.json 的插件文件夹');}
 if(manifest.name!==current.name||manifest.version!==current.version)throw new Error('所选目录与当前插件版本不匹配');
 const name='yanhe-update-probe-'+crypto.randomUUID()+'.txt',token=crypto.randomUUID();
 try{
  await writeFile(directory,name,new TextEncoder().encode(token));
  const response=await fetcher(getURL(name),{cache:'no-store'});
  if(!response.ok||await response.text()!==token)throw new Error('请选择当前加载的插件文件夹');
 }finally{await removeFile(directory,name);}
}

export async function restoreUpdate(directory,store,onProgress=()=>{}){
 const backups=await store.backups();
 // Restore all ordinary files first, then the original manifest.
 backups.sort((a,b)=>Number(a.path==='manifest.json')-Number(b.path==='manifest.json'));
 for(const [index,backup] of backups.entries()){
  if(backup.bytes===null)await removeFile(directory,backup.path);
  else await writeFile(directory,backup.path,backup.bytes);
  onProgress(index+1,backups.length);
 }
 await store.clear();
}

export async function installUpdate(directory,plan,current,store,onProgress=()=>{}){
 if(await store.pending())throw new Error('有未完成的更新，请先恢复原版本');
 const backups=[];
 let total=0;
 for(const [path] of plan.files){
  const bytes=await readFile(directory,path);
  total+=bytes?.length||0;
  if(total>MAX_CONTENT_BYTES)throw new Error('原插件备份内容过大');
  backups.push({path,bytes});
 }
 await store.prepare({from:current.version,to:plan.manifest.version,phase:'writing',createdAt:Date.now(),returnTab:current.returnTab||null},backups);
 try{
  for(const [index,[path,bytes]] of plan.files.entries()){
   await writeFile(directory,path,bytes);
   onProgress(index+1,plan.files.length);
  }
  await store.ready();
 }catch(error){
  try{await restoreUpdate(directory,store);}
  catch{throw new Error('更新中断，备份已保留。请恢复目录授权后点击“恢复原版本”。');}
  throw new Error('更新失败，已恢复原版本。'+error.message);
 }
}
