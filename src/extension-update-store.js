const databaseName='yanhe-extension-update';

function requestResult(request){
 return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}

async function database(){
 const request=indexedDB.open(databaseName,1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('backups',{keyPath:'path'});};
 return requestResult(request);
}

async function read(store,key){
 const db=await database();
 try{return await requestResult(db.transaction(store).objectStore(store).get(key));}
 finally{db.close();}
}

async function write(action){
 const db=await database();
 try{
  const transaction=db.transaction(['state','backups'],'readwrite',{durability:'strict'});
  const finished=new Promise((resolve,reject)=>{
   transaction.oncomplete=resolve;
   transaction.onabort=()=>reject(transaction.error||new Error('无法保存更新备份'));
   transaction.onerror=()=>{};
  });
  try{action(transaction.objectStore('state'),transaction.objectStore('backups'));}
  catch(error){transaction.abort();await finished.catch(()=>{});throw error;}
  await finished;
 }finally{db.close();}
}

export const updateStore={
 directory:()=>read('state','directory'),
 saveDirectory:directory=>write(state=>state.put(directory,'directory')),
 pending:()=>read('state','pending'),
 receipt:()=>read('state','receipt'),
 async backups(){
  const db=await database();
  try{return await requestResult(db.transaction('backups').objectStore('backups').getAll());}
  finally{db.close();}
 },
 prepare(pending,backups){return write((state,store)=>{
  store.clear();
  for(const backup of backups)store.put(backup);
  state.put(pending,'pending');state.delete('receipt');
 });},
 async ready(){
  const pending=await this.pending();
  if(!pending)throw new Error('更新备份记录缺失');
  await write(state=>state.put({...pending,phase:'ready'},'pending'));
 },
 clear:()=>write((state,backups)=>{state.delete('pending');backups.clear();}),
 async complete(version){
  let completed=false;
  await write((state,backups)=>{
   const request=state.get('pending');
   request.onsuccess=()=>{
    const pending=request.result;
    if(!pending||pending.phase!=='ready'||pending.to!==version)return;
    state.put({from:pending.from,to:pending.to,completedAt:Date.now(),returnTab:pending.returnTab||null},'receipt');
    state.delete('pending');backups.clear();completed=true;
   };
  });
  return completed;
 }
};
