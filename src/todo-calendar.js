import {pendingTask} from './task-status.js';

const encoder=new TextEncoder();
const escapeText=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[;,]/g,'\\$&').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
const timestamp=value=>new Date(value).toISOString().replace(/[-:]|\.\d{3}/g,'');

function fold(line){
 let output='',part='',length=0;
 for(const character of line){
  const size=encoder.encode(character).length;
  if(length+size>75){output+=part+'\r\n';part=' ';length=1;}
  part+=character;length+=size;
 }
 return output+part;
}

function taskUrl(task){
 try{
  const url=new URL(task.url),host=task.source==='lexue'?'lexue.bit.edu.cn':'zy-eclass.bit.edu.cn';
  if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password)return '';
  for(const key of [...url.searchParams.keys()])if(key!=='id')url.searchParams.delete(key);
  return url.href;
 }catch{return '';}
}

export function todoCalendar(rows,{now=Date.now()}={}){
 const entries=new Map();
 for(const task of rows){
  if(!['lms','lexue'].includes(task.source)||!/^\d{1,12}$/.test(String(task.courseId))||!/^\d{1,12}$|^ppt:\d{1,12}:\d{1,12}$/.test(String(task.id)))continue;
  if(task.state!=='pending'||task.detailError||!pendingTask(task,now)||!Number.isFinite(task.deadline)||task.deadline<=now||task.deadline>253402300799999)continue;
  entries.set([task.source,task.courseId,task.id].join(':'),task);
 }
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//yanhe-refine//Todo calendar//ZH','CALSCALE:GREGORIAN'];
 for(const [key,task] of entries){
  const url=taskUrl(task),platform=task.source==='lexue'?'旧乐学':'新乐学';
  lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(key)+'@yanhe-refine',
   'DTSTAMP:'+timestamp(now),'DTSTART:'+timestamp(task.deadline),
   'SUMMARY:'+escapeText([task.courseTitle,task.title].filter(Boolean).join(' · ')),
   'DESCRIPTION:'+escapeText(platform+(url?'\n'+url:'')),
   'TRANSP:TRANSPARENT',...(url?['URL:'+url]:[]),'END:VEVENT');
 }
 lines.push('END:VCALENDAR');
 return {text:lines.map(fold).join('\r\n')+'\r\n',count:entries.size};
}
