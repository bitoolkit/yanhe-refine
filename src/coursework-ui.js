import {downloadAttachment,downloadStatus,cancelDownload} from './remote-client.js';
import {attachmentJob} from './attachment-job.js';
import {richContent} from './rich-content.js';
import {MAX_UPLOAD_BYTES} from './lms-writer.js';
import {quizForm} from './ppt-quiz-ui.js';

export function courseworkUi({root,lms,lexue,node,button,link,loading,empty,toast,deadline,onSubmitted}){
 const $=id=>root.querySelector('#'+id),dialog=$('resources-dialog'),content=$('resource-content');let generation=0,busy=false;
 const bytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${n||0} B`;
 const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 for(const type of ['dragover','drop'])dialog.addEventListener(type,event=>{
  if(dialog.open&&fileDrag(event)){event.preventDefault();event.dataTransfer.dropEffect='none';}
 });
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{generation++;if(dialog.classList.contains('ppt-quiz-dialog'))content.replaceChildren();dialog.querySelectorAll('.ppt-copy-all,.ppt-copy-feedback').forEach(element=>element.remove());});
 $('close-dialog').onclick=()=>{if(!busy)dialog.close();};
 function open(title,wide=false){generation++;dialog.classList.remove('ppt-quiz-dialog');dialog.querySelectorAll('.ppt-copy-all,.ppt-copy-feedback').forEach(element=>element.remove());dialog.classList.toggle('task-dialog',wide);dialog.querySelector('h2').textContent=title;content.replaceChildren(loading());if(!dialog.open)dialog.showModal();return generation;}
 const current=g=>g===generation&&dialog.open;
 async function files(row){return row.source==='lexue'?lexue.resources(row.courseId,row.id):row.source==='lms'?lms.resources(row.courseId,row.id):row.attachments||[];}
 async function download(row,file,status,signal){
  status.disabled=true;status.textContent='下载中…';
  try{
   await attachmentJob({start:()=>downloadAttachment({source:row.source,courseId:row.courseId,id:row.id,fileId:file.id,referenceId:file.referenceId,submissionId:row.submissionId,folder:row.courseTitle||'课程资料'}),status:downloadStatus,cancel:cancelDownload},signal);status.textContent='已下载';
   return true;
  }catch(e){if(e.name==='AbortError'){status.textContent='已取消';return null;}status.textContent='重试下载';status.title=e.message;toast(e.message);return false;}
  finally{status.disabled=false;}
 }
 function attachment(row,file){const action=button('下载',()=>void download(row,file,action),'text-button',{disabled:file.download?null:'',title:file.download?'下载附件':'未开放下载'});
  return node('div',{class:'attachment-row'},node('div',{class:'attachment-name'},file.name,file.size?node('small',{},bytes(file.size)):null),action);
 }
 async function resources(row){const g=open(row.title);try{const data=row.source==='lexue'?await lexue.material(row.courseId,row.id):{attachments:await files(row)},list=data.attachments;if(!current(g))return;content.replaceChildren(...(data.description?[richContent(data.description)]:[]),...(list.length?list.map(f=>attachment(row,f)):data.description?[]:[empty('暂无附件')]),node('div',{class:'dialog-footer'},link('原站',row.url,'text-button')));}catch(e){if(current(g))content.replaceChildren(empty(e.message,[button('重试',()=>void resources(row)),link('原站',row.url,'text-button')]));}}
 function allButton(rows,title){const action=button('全部下载',()=>void downloadAll(rows,title),'attachment-button',{'aria-label':'下载本课全部资料附件',disabled:rows.length?null:''});return action;}
 async function downloadAll(rows,title){
  const g=open('下载资料');const queue=[],failures=[];const seen=new Set(),cancellation=new AbortController();let total=0,finished=0,failed=0,stopped=false;
  const progress=node('p',{class:'download-progress',role:'status'},'正在整理附件…'),list=node('div'),cancel=button('停止',()=>{stopped=true;cancellation.abort();cancel.disabled=true;cancel.textContent='正在停止…';},'text-button');
  content.replaceChildren(progress,list,node('div',{class:'dialog-footer'},cancel));
  for(const row of rows){if(!current(g))return;if(stopped)break;try{for(const file of await files(row)){const key=row.source+':'+(file.referenceId||file.id);if(seen.has(key)||!file.download)continue;seen.add(key);queue.push({row:{...row,courseTitle:title||row.courseTitle},file});}}catch(e){failures.push(row.title+'：'+e.message);}}
  if(!current(g))return;total=queue.length;
  for(const {row,file} of queue){if(!current(g)||stopped)break;const state=button('等待',()=>void download(row,file,state),'text-button'),item=node('div',{class:'attachment-row'},node('div',{class:'attachment-name'},file.name),state);list.append(item);
   progress.textContent=`${finished+failed} / ${total}`;const ok=await download(row,file,state,cancellation.signal);if(ok===true)finished++;else if(ok===false)failed++;
  }
  if(current(g)){progress.textContent=`已下载 ${finished} / ${total}${failed?'，失败 '+failed:''}${stopped?' · 已停止后续任务':''}`;cancel.remove();if(!total&&!failures.length)progress.textContent=stopped?'已停止':'暂无可下载附件';for(const message of failures)list.append(node('p',{class:'inline-notice'},message));}
 }
 async function task(row){
  const g=open(row.title,true);
  if(row.type==='ppt-quiz-error'){content.replaceChildren(empty('PPT 答题列表暂未同步，请刷新待办重试',[link('原站',row.url,'text-button')]));return;}
  try{
   if(row.type==='ppt-quiz'){
    dialog.classList.add('ppt-quiz-dialog');
    const data=await lms.quiz(row.courseId,row.activityId,row.quizId);if(!current(g))return;
    content.replaceChildren(quizForm({row,data,node,button,link,deadline,heading:dialog.querySelector('.dialog-heading'),
     submit:payload=>lms.submitQuiz(row.courseId,row.activityId,row.quizId,payload),refresh:()=>void task(row),isCurrent:()=>current(g),
     setBusy:value=>{busy=value;$('close-dialog').disabled=value;},onSubmitted}));
   }else{const data=await (row.source==='lexue'?lexue:lms).task(row.courseId,row.id);if(current(g))renderTask(row,data,g);}
  }catch(e){if(current(g))content.replaceChildren(empty(e.message,[button('重试',()=>void task(row)),link('原站',row.url,'text-button')]));}
 }
 function renderTask(row,data,g){
  const meta=node('div',{class:'task-meta'},node('span',{},deadline(data.deadline)),data.group==null?null:node('span',{},data.group?data.groupName||'小组作业':'个人作业'),data.limit!==null?node('span',{},`已提交 ${data.used} / ${data.limit} 次`):null,link('原站',row.url,'text-button'));
  const description=richContent(data.description),attachments=node('div',{class:'task-attachments'},data.attachments.map(f=>attachment(row,f)));
  const history=node('details',{class:'submission-history'},node('summary',{},data.historyError?'提交记录 · 未同步':`提交记录 · ${data.submissions.filter(s=>!s.draft).length}`),data.historyError?button('刷新记录',()=>void task(row),'text-button'):null,data.submissions.map(s=>node('section',{class:'submission-entry'},node('div',{class:'task-meta'},node('span',{},s.draft?'原站草稿':s.redo?'待重新提交':'已提交'),node('time',{},s.createdAt?new Date(s.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'')),richContent(s.comment),s.attachments.map(f=>attachment({...row,submissionId:s.id},f)))));
  const form=node('form',{class:'submission-form'}),comment=node('textarea',{'aria-label':'作业内容',placeholder:'作业内容',rows:5,maxlength:100000}),picked=node('div',{class:'picked-files'}),notice=node('p',{class:'submission-notice',role:'status'});let selected=[],inFlight=false,requestId=crypto.randomUUID();const uploaded=new Map();
  const input=node('input',{type:'file',multiple:'','aria-label':'选择作业附件',onchange:()=>chooseFiles(Array.from(input.files||[]))});
  const submit=node('button',{type:'submit',class:'primary'},'提交作业');
  const dropZone=node('div',{class:'upload-choice',role:'group','aria-label':'作业附件'},node('span',{class:'upload-drop-hint'},'将文件拖到这里，或选择文件'),input,node('small',{},'最多 30 个附件，每个 ≤ 32 MB'));
  let dragDepth=0;
  const editable=()=>!inFlight&&!submit.hidden&&current(g);
  function syncPicker(){
   const transfer=new DataTransfer();for(const file of selected)transfer.items.add(file);input.files=transfer.files;
  }
  function chooseFiles(files,append=false){
   if(!editable())return;
   const chosen=append?[...selected]:[];
   for(const file of files){
    const duplicate=chosen.some(existing=>existing.name===file.name&&existing.size===file.size&&existing.lastModified===file.lastModified);
    if(!duplicate)chosen.push(file);
    if(chosen.length>30)break;
   }
   if(chosen.length>30||chosen.some(file=>!file.size||file.size>MAX_UPLOAD_BYTES)){
    notice.textContent='最多 30 个附件，每个 1 B～32 MB';syncPicker();return;
   }
   selected=chosen;if(!append)uploaded.clear();syncPicker();notice.textContent='';
   picked.replaceChildren(...selected.map(file=>node('div',{class:'picked-file'},file.name,node('small',{},bytes(file.size)))));
   requestId=crypto.randomUUID();
  }
  function clearDrag(){dragDepth=0;dropZone.classList.remove('drag-over');}
  form.addEventListener('dragenter',event=>{
   if(!fileDrag(event))return;event.preventDefault();dragDepth++;if(editable())dropZone.classList.add('drag-over');
  });
  form.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)clearDrag();});
  form.addEventListener('dragover',event=>{
   if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=editable()?'copy':'none';
  });
  form.addEventListener('drop',event=>{
   if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();clearDrag();if(!editable())return;
   const items=Array.from(event.dataTransfer.items||[]),files=Array.from(event.dataTransfer.files||[]);
   if(items.some(item=>item.webkitGetAsEntry?.()?.isDirectory)){
    notice.textContent='请先将文件夹压缩后再添加';return;
   }
   if(!files.length){notice.textContent='请拖入本地文件';return;}
   chooseFiles(files,true);
  });
  form.append(node('h3',{},'提交作业'),comment,dropZone,picked,notice,node('div',{class:'dialog-footer'},submit));
  const freeze=value=>{
   inFlight=value;busy=value;$('close-dialog').disabled=value;clearDrag();
   const locked=value||submit.hidden;for(const el of [input,comment,submit])el.disabled=locked;dropZone.setAttribute('aria-disabled',String(locked));
  };
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(inFlight||!current(g))return;if(!comment.value.trim()&&!selected.length){notice.textContent='请填写内容或选择附件';return;}
   freeze(true);submit.textContent='正在提交…';
   try{
    for(let i=0;i<selected.length;i++){
     const file=selected[i];if(uploaded.has(file))continue;notice.textContent=`上传附件 ${i+1} / ${selected.length}`;
     const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('附件读取失败'));reader.readAsDataURL(file);});
     const result=await lms.upload(row.courseId,row.id,{name:file.name,size:file.size,encoded});uploaded.set(file,result.id);
    }
    notice.textContent='正在核对提交结果…';
    const result=await lms.submit(row.courseId,row.id,{requestId,comment:comment.value,uploads:[...uploaded.values()]});
    if(result.status!=='submitted'){
     notice.textContent=result.message||'提交结果待核对';submit.hidden=true;form.append(button('刷新提交记录',()=>void task(row),'text-button'));return;
    }
    onSubmitted(row);toast('作业已提交');notice.textContent='作业已提交';submit.hidden=true;input.disabled=true;comment.disabled=true;
    try{const updated=await lms.task(row.courseId,row.id);if(current(g)){freeze(false);renderTask(row,updated,g);content.querySelector('.submission-history').open=true;}}
    catch{notice.textContent='作业已提交，记录暂未刷新';form.append(button('刷新提交记录',()=>void task(row),'text-button'));}
   }catch(error){notice.textContent=error.message;submit.textContent='重试提交';}
   finally{freeze(false);if(!submit.hidden)submit.textContent='提交作业';}
  });
  const editor=data.submissions.some(s=>!s.draft)?node('details',{class:'resubmit-form'},node('summary',{},'再次提交'),form):form;
  content.replaceChildren(meta,description,attachments,history,data.canSubmit?editor:node('div',{class:'dialog-footer'},node('span',{class:'muted'},data.submitReason),link(data.nativeAction||'在原站查看',row.url,'button-link')));
 }
 let context=null;
 function setContext(value){if(value===context)return;context=value;if(!busy){generation++;if(dialog.open)dialog.close();}}
 return {resources,task,allButton,setContext};
}
