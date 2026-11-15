import md5 from 'blueimp-md5';
import {SharedReads} from './shared-reads.js';
import {pendingTask} from './task-status.js';

export class TaskDetailsCache{
 constructor(now=()=>Date.now()){
  this.now=now;this.entries=new Map();this.loads=new SharedReads();
 }
 clear(){this.entries.clear();this.loads=new SharedReads();}
 peek(key){return this.entries.get(key)?.rows;}
 async read(key,metadata,load,{signal,force=false}={}){
  signal?.throwIfAborted();
  const version=md5(JSON.stringify(metadata)),saved=this.entries.get(key);
  if(!force&&saved?.version===version&&saved.expires>this.now())return saved.rows;
  const entry=!force&&saved?.version===version&&this.loads.has(saved)?saved:{version,expires:0,rows:saved?.rows};
  this.entries.set(key,entry);
  while(this.entries.size>1000)this.entries.delete(this.entries.keys().next().value);
  return this.loads.read(entry,async inner=>{
   const rows=await load(inner);inner.throwIfAborted();
   if(this.entries.get(key)===entry){
    entry.rows=rows;
    const reusable=rows.every(row=>!pendingTask(row,this.now())&&row.state!=='unknown'&&!row.detailError);
    entry.expires=this.now()+(reusable?5*60000:0);
   }
   return rows;
  },{signal});
 }
}
