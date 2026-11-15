const prefix='desk:quiz-draft:';

export async function quizDraft(row,data,storage=chrome.storage.local){
 const ids=[data.userId,row.courseId,row.activityId,row.quizId].map(String);
 if(ids.some(id=>!/^\d{1,12}$/.test(id)))throw new Error('无法确认答题草稿所属账号');
 const key=prefix+ids.join(':');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.version));
 const version=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 let saved;
 try{saved=(await storage.get(key))[key];}catch{}
 const matches=saved?.version===version&&saved.used===data.used&&Array.isArray(saved.answers);
 let writes=Promise.resolve();
 function write(action){
  const previous=writes;
  writes=(async()=>{await previous.catch(()=>{});return action();})();
  return writes;
 }
 return {
  answers:matches?saved.answers:null,
  save(answers){
   const value={version,used:data.used,answers};
   return write(()=>storage.set({[key]:value}));
  },
  clear(){return write(()=>storage.remove(key));}
 };
}
