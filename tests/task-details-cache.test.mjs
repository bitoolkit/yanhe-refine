import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskDetailsCache} from '../src/task-details-cache.js';
import {LmsReader} from '../src/lms-reader.js';
import {LexueReader} from '../src/lexue-reader.js';
import {CourseworkCache} from '../src/coursework-cache.js';

test('unchanged inactive activity results reuse for five minutes; pending, changed and forced reads refresh',async()=>{
 let now=1000,calls=0;const cache=new TaskDetailsCache(()=>now);
 const load=async()=>{calls++;return [];};
 await cache.read('1',{title:'first'},load);await cache.read('1',{title:'first'},load);assert.equal(calls,1);
 await cache.read('1',{title:'changed'},load);assert.equal(calls,2);
 await cache.read('1',{title:'changed'},load,{force:true});assert.equal(calls,3);
 now+=300001;await cache.read('1',{title:'changed'},load);assert.equal(calls,4);
 const pending=async()=>{calls++;return [{state:'pending',deadline:now+10000}];};
 await cache.read('2',{},pending);await cache.read('2',{},pending);assert.equal(calls,6);
});

test('cache reset and cancellation cannot restore obsolete activity data',async()=>{
 const cache=new TaskDetailsCache();let release;
 const first=cache.read('1',{},()=>new Promise(resolve=>release=resolve));await Promise.resolve();
 cache.clear();await cache.read('1',{},async()=>[{state:'submitted',title:'new'}]);release([]);await first;
 assert.equal(cache.peek('1')[0].title,'new');
 const cancellation=new AbortController();cancellation.abort();
 await assert.rejects(cache.read('1',{},async()=>[],{signal:cancellation.signal}),{name:'AbortError'});
});

test('a second scan of 100 unchanged empty PPT activities makes one list request and skips the 100 quiz requests',async()=>{
 let requests=0,quizzes=0;
 const reader=new LmsReader(async raw=>{
  requests++;const path=new URL(raw).pathname;
  if(path==='/api/my-courses')return Response.json({courses:[{id:10,name:'合成课程',academic_year:'2026-2027',semester:{real_name:'第一学期'}}]});
  if(path.endsWith('/courseware-activities'))return Response.json(Array.from({length:100},(_,index)=>({id:index+20,course_id:10,type:'material',published:true,title:'PDF'})));
  if(path.endsWith('/quizzes')){quizzes++;return Response.json([]);}throw Error(path);
 });
 await reader.pptHomeworks(10);assert.equal(quizzes,100);const before=requests;
 await reader.pptHomeworks(10);assert.equal(requests-before,1);assert.equal(quizzes,100);
 await reader.pptHomeworks(10,undefined,{force:true});assert.equal(quizzes,200);
});

test('old LMS refreshes pending details and reuses completed details until a forced scan',async()=>{
 const reader=new LexueReader();let reads=0;
 reader.course=async()=>[{id:'1',type:'task',title:'pending'},{id:'2',type:'task',title:'done'}];
 reader.task=async(_course,id)=>{reads++;return {id,state:id==='1'?'pending':'submitted'};};
 await reader.homeworks('10');assert.equal(reads,2);
 await reader.homeworks('10');assert.equal(reads,3);
 await reader.homeworks('10',undefined,{force:true});assert.equal(reads,5);
});

test('course task snapshots survive an explicit refresh and a failed read',async()=>{
 const cache=new CourseworkCache(),course={source:'lms',id:'10',title:'课程'};
 await cache.read(course,async()=>[{id:'1',courseId:'10',state:'pending'}]);
 cache.invalidate('lms',{keepRows:true});assert.equal(cache.peek(course).length,1);
 await assert.rejects(cache.read(course,async()=>{throw Error('offline');}),/offline/);
 assert.equal(cache.peek(course).length,1);
});
