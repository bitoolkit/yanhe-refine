import {isTrue, text} from './catalog-core.js';
import {activityUrl, schoolEpoch} from './lms-core.js';

const validId=value=>/^[1-9]\d{0,11}$/.test(String(value??''));
export const quizActivity=entry=>['material','resource','courseware','online_video'].includes(entry.type);

export function quizPreviewUrl(value){
 let url;try{url=new URL(value);}catch{throw new Error('课件预览地址无效');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['zy-media.bit.edu.cn','zy-eclass.bit.edu.cn'].includes(url.hostname))throw new Error('课件预览地址无效');
 return url.href;
}

export function quizRows(quizzes,references,entry,courseId,term=''){
 if(!Array.isArray(quizzes))throw new Error('PPT 答题列表格式异常');
 const files=new Map((references.references||[]).filter(row=>!isTrue(row.deleted)&&!isTrue(row.upload?.deleted)).map(row=>[String(row.id),row]));
 const seen=new Set();
 return quizzes.filter(quiz=>Number(quiz.subjects_count)>0).map(quiz=>{
  if(!validId(quiz.id)||!validId(quiz.upload_reference_id)||seen.has(String(quiz.id)))throw new Error('PPT 答题编号异常');
  seen.add(String(quiz.id));const file=files.get(String(quiz.upload_reference_id));
  if(!file||file.parent_id!=null&&String(file.parent_id)!==String(entry.id))throw new Error('PPT 答题与课件附件不一致');
  const used=Number(quiz.submitted_times),known=quiz.submitted_times!=null&&Number.isInteger(used)&&used>=0;
  return {id:`ppt:${entry.id}:${quiz.id}`,type:'ppt-quiz',activityId:String(entry.id),quizId:String(quiz.id),referenceId:String(file.id),
   courseId:String(courseId),title:(text(file.name||file.upload?.name)||entry.title)+' · PPT 答题',activityTitle:text(entry.title),
   questionCount:Number(quiz.subjects_count),state:known?(used>0?'submitted':'pending'):isTrue(quiz.has_submission)?'submitted':'unknown',
   deadline:schoolEpoch(entry.end_time,term),start:schoolEpoch(entry.start_time,term),closed:isTrue(entry.is_closed),url:activityUrl(courseId,entry.id)};
 });
}

export function quizSubjects(body){
 if(!Array.isArray(body.subjects)||!body.subjects.length||body.subjects.length>1000)throw new Error('未能读取 PPT 题目');
 const ids=new Set();
 return [...body.subjects].sort((a,b)=>Number(a.sort)-Number(b.sort)).map(row=>{
  if(!validId(row.id)||ids.has(String(row.id)))throw new Error('PPT 题目编号异常');ids.add(String(row.id));
  const optionIds=new Set(),options=[...(row.options||[])].sort((a,b)=>Number(a.sort)-Number(b.sort)).map(option=>{
   if(!/^\d{1,12}$/.test(String(option.id))||optionIds.has(String(option.id)))throw new Error('PPT 选项编号异常');optionIds.add(String(option.id));
   return {id:String(option.id),content:text(option.content)};
  });
  const blanks=Number(row.answer_number)||0,type=text(row.type);
  const supported=['single_selection','multiple_selection','true_or_false'].includes(type)?options.length>=2:
   type==='fill_in_blank'?blanks>0&&blanks<=100:['short_answer','text'].includes(type);
  return {id:String(row.id),type,description:text(row.description),options,blanks,supported};
 });
}

export const quizVersion=subjects=>JSON.stringify(subjects);

export function quizAnswers(subjects,answers){
 if(!Array.isArray(answers)||answers.length!==subjects.length)throw new Error('请完成全部题目');
 const indexed=new Map(answers.map(row=>[String(row.subject_id),row]));if(indexed.size!==subjects.length)throw new Error('答题题目重复');
 return subjects.map(subject=>{
  const row=indexed.get(subject.id);if(!subject.supported||!row||row.type!==subject.type)throw new Error('题目已变化，请刷新后重新核对');
  const chosen=row.answer_option_ids||[],written=row.answers||[];
  if(!Array.isArray(chosen)||!Array.isArray(written))throw new Error('答案格式异常');
  const choice=['single_selection','multiple_selection','true_or_false'].includes(subject.type);
  if(choice){
   if(!chosen.length||subject.type!=='multiple_selection'&&chosen.length!==1||new Set(chosen.map(String)).size!==chosen.length||chosen.some(id=>!subject.options.some(option=>option.id===String(id)))||written.length)throw new Error('请选择有效选项');
   return {subject_id:Number(subject.id),type:subject.type,answer_option_ids:chosen.map(Number),answers:[]};
  }
  const count=subject.type==='fill_in_blank'?subject.blanks:1;
  if(chosen.length||written.length!==count||written.some((answer,index)=>answer.sort!==index||typeof answer.content!=='string'||!answer.content.trim()||answer.content.length>100000))throw new Error('请填写完整答案');
  return {subject_id:Number(subject.id),type:subject.type,answer_option_ids:[],answers:written.map(answer=>({sort:answer.sort,content:answer.content.trim()}))};
 });
}

export function sameQuizAnswers(expected,actual){
 const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>Number(a.subject_id)-Number(b.subject_id)).map(row=>({id:String(row.subject_id),type:row.type,
  choices:(row.answer_option_ids||[]).map(String).sort(),answers:[...(row.answers||[])].sort((a,b)=>a.sort-b.sort).map(answer=>({sort:answer.sort,content:answer.content}))})));
 return Array.isArray(actual)&&canonical(expected)===canonical(actual);
}
