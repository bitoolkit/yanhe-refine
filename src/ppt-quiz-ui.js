import katex from 'katex';
import {richContent} from './rich-content.js';

function questionContent(value){
 const root=richContent(value),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),texts=[];
 while(walker.nextNode())texts.push(walker.currentNode);
 for(const text of texts){
  const expression=/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g,matches=[...text.textContent.matchAll(expression)];if(!matches.length)continue;
  const fragment=document.createDocumentFragment();let offset=0;
  for(const match of matches){
   fragment.append(document.createTextNode(text.textContent.slice(offset,match.index)));
   const formula=document.createElement('span');formula.className='quiz-formula';
   formula.innerHTML=katex.renderToString(match[1]||match[2],{output:'mathml',displayMode:Boolean(match[1]),throwOnError:false,trust:false,strict:'ignore',maxExpand:1000});
   fragment.append(formula);offset=match.index+match[0].length;
  }
  fragment.append(document.createTextNode(text.textContent.slice(offset)));text.replaceWith(fragment);
 }
 return root;
}

const labels={single_selection:'单选题',multiple_selection:'多选题',true_or_false:'判断题',fill_in_blank:'填空题',short_answer:'简答题',text:'简答题'};

function questionText(subject,index){
 const plain=value=>{
  const content=richContent(value);
  content.querySelectorAll('br').forEach(element=>element.replaceWith('\n'));
  content.querySelectorAll('p,div,li,tr,blockquote,pre,h1,h2,h3,h4,h5,h6').forEach(element=>element.append('\n'));
  content.querySelectorAll('td,th').forEach(element=>element.append('\t'));
  return content.textContent
   .replace(/\u00a0/g,' ')
   .replace(/[ \t]+\n/g,'\n')
   .replace(/\n{3,}/g,'\n\n')
   .trim();
 };
 return [
  `${index+1}. ${labels[subject.type]||'题目'}`,
  plain(subject.description),
  ...subject.options.map((option,optionIndex)=>`${String.fromCharCode(65+optionIndex)}. ${plain(option.content)}`)
 ].join('\n');
}

export function quizForm({row,data,node,button,link,deadline,submit,refresh,setBusy,isCurrent,onSubmitted,heading}){
 const form=node('form',{class:'ppt-quiz-form'}),status=node('p',{class:'submission-notice',role:'status'}),inputs=[];
 const copyFeedback=node('span',{class:'ppt-copy-feedback',role:'status','aria-live':'polite'});
 let inFlight=false,uncertain=false,editing=data.used===0,requestId=crypto.randomUUID();
 async function writeClipboard(value){
  try{
   if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value);
    return;
   }
  }catch{}
  if(!isCurrent())throw new Error('答题窗口已关闭');
  const active=form.getRootNode().activeElement;
  const buffer=node('textarea',{class:'ppt-clipboard-buffer',readonly:'',tabindex:'-1'});
  buffer.value=value;
  form.append(buffer);
  try{
   buffer.focus({preventScroll:true});
   buffer.select();
   if(!document.execCommand('copy'))throw new Error('复制失败');
  }finally{
   buffer.remove();
   if(active?.isConnected)active.focus({preventScroll:true});
  }
 }
 function copyAction(subjects,startIndex,all=false){
  const label=all?'复制全部题目':'复制';
  const accessible=all?label:`复制第 ${startIndex+1} 题`;
  let resetTimer;
  const action=button(label,async()=>{
   action.disabled=true;
   try{
    const text=subjects.map((subject,index)=>questionText(subject,startIndex+index)).join('\n\n');
    await writeClipboard(text);
    if(!isCurrent())return;
    action.textContent='已复制';
    copyFeedback.textContent=all?`已复制全部 ${subjects.length} 道题目`:`已复制第 ${startIndex+1} 题`;
   }catch{
    if(isCurrent()){
     action.textContent='复制失败';
     copyFeedback.textContent='复制失败，请重试';
    }
   }finally{
    action.disabled=false;
    clearTimeout(resetTimer);
    resetTimer=setTimeout(()=>{action.textContent=label;},1600);
   }
  },all?'ppt-copy-all':'ppt-copy-question',{'aria-label':accessible,title:accessible});
  return action;
 }
 heading.append(copyFeedback);
 heading.insertBefore(copyAction(data.subjects,0,true),heading.querySelector('#close-dialog'));
 const answerMap=new Map(data.answers.map(answer=>[String(answer.subject_id),answer]));
 for(const [index,subject] of data.subjects.entries()){
  const answer=answerMap.get(subject.id),card=node('fieldset',{class:'ppt-quiz-card'},
   node('legend',{class:'ppt-question-legend'},node('span',{},`${index+1}. ${labels[subject.type]||'题目'}`),copyAction([subject],index)),questionContent(subject.description));
  const controls=[];
  if(['single_selection','multiple_selection','true_or_false'].includes(subject.type)){
   for(const [optionIndex,option] of subject.options.entries()){
    const input=node('input',{type:subject.type==='multiple_selection'?'checkbox':'radio',name:'ppt-'+subject.id,value:option.id,'aria-label':`${index+1} 题选项 ${optionIndex+1}`});
    input.checked=(answer?.answer_option_ids||[]).some(id=>String(id)===option.id);
    card.append(node('label',{class:'ppt-quiz-option'},input,node('span',{},String.fromCharCode(65+optionIndex)+'.'),questionContent(option.content)));controls.push(input);
   }
  }else if(subject.supported){
   const count=subject.type==='fill_in_blank'?subject.blanks:1;
   for(let blank=0;blank<count;blank++){
    const input=node('textarea',{rows:subject.type==='fill_in_blank'?2:4,'aria-label':`${index+1} 题答案 ${blank+1}`,maxlength:100000});
    input.value=answer?.answers?.find(value=>value.sort===blank)?.content||'';
    card.append(node('label',{class:'ppt-quiz-written'},count>1?`第 ${blank+1} 空`:'答案',input));controls.push(input);
   }
  }else card.append(node('p',{class:'inline-notice'},'此题型请在原站作答'));
  inputs.push({subject,controls});form.append(card);
 }
 const progress=node('span',{class:'muted'}),send=node('button',{type:'submit',class:'primary'},'提交全部答案');
 const retry=button('重新作答',()=>{editing=true;requestId=crypto.randomUUID();sync();},'text-button');
 const reload=button('刷新作答记录',refresh,'text-button');
 function answers(){return inputs.map(({subject,controls})=>{
  const choice=['single_selection','multiple_selection','true_or_false'].includes(subject.type);
  return {subject_id:Number(subject.id),type:subject.type,answer_option_ids:choice?controls.filter(input=>input.checked).map(input=>Number(input.value)):[],
   answers:choice?[]:controls.map((input,sort)=>({sort,content:input.value}))};
 });}
 function sync(){
  const locked=inFlight||!data.canSubmit||!editing||uncertain;
  for(const {controls} of inputs)for(const input of controls)input.disabled=locked;
  const completed=answers().filter(answer=>answer.answer_option_ids.length||answer.answers.length&&answer.answers.every(value=>value.content.trim())).length;
  progress.textContent=`已填写 ${completed} / ${data.subjects.length} 题`;
  send.hidden=!data.canSubmit||!editing||uncertain;send.disabled=inFlight||completed!==data.subjects.length;send.textContent=inFlight?'正在提交…':'提交全部答案';
  retry.hidden=!data.canSubmit||editing||uncertain;reload.disabled=inFlight;
 }
 form.addEventListener('input',sync);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(inFlight||send.disabled||send.hidden||!isCurrent())return;
  inFlight=true;setBusy(true);sync();status.textContent='正在核对题目与答题次数…';
  try{
   const result=await submit({requestId,version:data.version,answers:answers()});if(!isCurrent())return;
   if(result.status==='submitted'){
    status.textContent='答题已提交';data.used++;editing=false;data.canSubmit=data.used<data.limit;
    stateLabel.textContent='已作答';attemptLabel.textContent=`已提交 ${data.used} / ${data.limit} 次`;onSubmitted(row);
   }
   else{uncertain=true;status.textContent=result.message||'答题结果待核对，请刷新作答记录';}
  }catch(error){status.textContent=error.message;}
  finally{inFlight=false;setBusy(false);sync();}
 });
 const stateLabel=node('span',{},data.used?'已作答':'未作答'),attemptLabel=node('span',{},`已提交 ${data.used} / ${data.limit} 次`);
 const meta=node('div',{class:'task-meta'},stateLabel,attemptLabel,node('span',{},deadline(data.deadline)),link('原站',row.url,'text-button'));
 form.append(status,node('div',{class:'dialog-footer'},progress,retry,reload,send));sync();
 const source=new URL(chrome.runtime.getURL('courseware-viewer.html'));
 source.search=new URLSearchParams({course:row.courseId,activity:row.activityId,quiz:row.quizId}).toString();
 const documentPane=node('section',{class:'ppt-document-pane','aria-label':'课件预览'},node('iframe',{src:source.href,title:'原课件预览',loading:'lazy'}));
 const questionsPane=node('section',{class:'ppt-question-pane','aria-label':'全部题目'},meta,!data.canSubmit&&data.submitReason?node('p',{class:'inline-notice'},data.submitReason):null,form);
 const workspace=node('div',{class:'ppt-quiz-workspace','data-pane':'answers'});
 const documentTab=button('课件',()=>selectPane('document'),'text-button',{'aria-pressed':'false'});
 const answersTab=button('答题',()=>selectPane('answers'),'text-button',{'aria-pressed':'true'});
 function selectPane(pane){workspace.dataset.pane=pane;documentTab.setAttribute('aria-pressed',String(pane==='document'));answersTab.setAttribute('aria-pressed',String(pane==='answers'));}
 workspace.append(node('div',{class:'ppt-pane-tabs',role:'group','aria-label':'切换课件和题目'},documentTab,answersTab),documentPane,questionsPane);
 return workspace;
}
