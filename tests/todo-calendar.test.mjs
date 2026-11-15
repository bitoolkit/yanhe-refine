import test from 'node:test';
import assert from 'node:assert/strict';
import {todoCalendar} from '../src/todo-calendar.js';

const now=Date.parse('2026-11-15T12:00:00+08:00');
const task={source:'lms',courseId:'20290',id:'2422',courseTitle:'计算机视觉',title:'大作业',state:'pending',deadline:Date.parse('2027-01-03T23:55:00+08:00'),url:'https://zy-eclass.bit.edu.cn/course/20290/learning-activity/full-screen#/2422'};

test('calendar preserves next-year deadlines, platform identities and stable UIDs',()=>{
 const first=todoCalendar([task,task,{...task,source:'lexue',url:'https://lexue.bit.edu.cn/mod/assign/view.php?id=2422'}],{now});
 assert.equal(first.count,2);assert.match(first.text,/DTSTART:20270103T155500Z/);
 assert.match(first.text,/UID:lms%3A20290%3A2422@yanhe-refine/);assert.match(first.text,/UID:lexue%3A20290%3A2422@yanhe-refine/);
 const later=todoCalendar([{...task,deadline:task.deadline+86400000}],{now:now+1000});
 assert.equal(first.text.match(/UID:.*/)[0],later.text.match(/UID:.*/)[0]);assert.match(later.text,/DTSTART:20270104T155500Z/);
});

test('calendar exports only confirmed pending tasks with future deadlines',()=>{
 const cases=[task,{...task,id:'2',state:'submitted'},{...task,id:'3',deadline:now-1},{...task,id:'4',deadline:null},{...task,id:'5',state:'unknown'},{...task,id:'6',detailError:true},{...task,id:'7',deadline:Infinity}];
 assert.equal(todoCalendar(cases,{now}).count,1);
 const ppt={...task,id:'ppt:6501:75',activityId:'6501',quizId:'75'};
 assert.equal(todoCalendar([ppt],{now}).count,1);
});

test('calendar escapes text, folds UTF-8 at 75 octets and excludes credentials from links',()=>{
 const value={...task,title:'测试中文😀'.repeat(30)+'\r\nEND:VEVENT;X,\\',url:task.url.replace('/full-screen','/full-screen?token=secret')};
 const result=todoCalendar([value],{now}),lines=result.text.split('\r\n');
 assert.ok(lines.every(line=>Buffer.byteLength(line,'utf8')<=75));
 const unfolded=result.text.replace(/\r\n[ \t]/g,'');
 assert.equal(unfolded.split('\r\nEND:VEVENT\r\n').length-1,1);
 assert.match(unfolded,/\\nEND:VEVENT\\;X\\,\\\\/);assert.ok(!unfolded.includes('secret'));
 assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(new TextEncoder().encode(result.text)),result.text);
});
