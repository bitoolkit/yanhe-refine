import test from 'node:test';
import assert from 'node:assert/strict';
import {LmsReader} from '../src/lms-reader.js';
import {LmsWriter} from '../src/lms-writer.js';
import {quizRows,quizAnswers,quizSubjects,quizPreviewUrl} from '../src/ppt-quiz.js';

const entry={id:30,course_id:10,type:'material',title:'课程课件',published:true,is_in_progress:true};
const quizzes=[{id:40,subjects_count:1,submitted_times:0,upload_reference_id:400},{id:41,subjects_count:1,submitted_times:1,upload_reference_id:401}];
const references={references:[{id:400,parent_id:30,name:'未答课件.pdf'},{id:401,parent_id:30,name:'已答课件.pdf'}]};
const subjects={subjects:[{id:100,type:'single_selection',description:'合成题目',sort:0,options:[{id:200,sort:0,content:'选项一'},{id:201,sort:1,content:'选项二'}]}]};
const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const answers=[{subject_id:100,type:'single_selection',answer_option_ids:[200],answers:[]}];

function fixture(){
 const state={used:0,answers:[],writes:[],quizFailure:false,disconnect:false,historyFailure:false,changed:false,userId:7,
  previewUrl:'https://zy-media.bit.edu.cn/download/file/fixture.pdf?signature=synthetic'};
 const memory={};state.session={get:async key=>({[key]:memory[key]}),set:async values=>Object.assign(memory,values),remove:async key=>delete memory[key]};
 state.reader=new LmsReader(async(raw,options)=>{
  const path=new URL(raw).pathname;
  if(options.method==='POST'){
   assert.equal(path,'/api/courseware-quiz/quiz/40/submissions');const body=JSON.parse(options.body);state.writes.push(body);
   state.used++;state.answers=body.subjects_answers;
   if(state.disconnect){state.historyFailure=true;throw new TypeError('synthetic disconnect after accept');}
   return json({});
  }
  if(path==='/api/my-courses')return json({courses:[{id:10,name:'合成课程',academic_year:'2026-2027',semester:1}]});
  if(path==='/api/course/10/courseware-activities')return json([entry,{...entry,id:31,published:false}]);
  if(path==='/api/activities/30')return json(entry);
  if(path==='/api/activities/30/upload_references')return json(references);
  if(path==='/api/uploads/reference/document/400/url')return json({status:'ready',url:state.previewUrl});
  if(path==='/api/courseware-quiz/activity/30/quizzes')return state.quizFailure?new Response('',{status:503}):json(quizzes.map(q=>({...q,submitted_times:q.id===40?state.used:q.submitted_times})));
  if(path==='/api/courseware-quiz/quiz/40/subjects')return json(state.changed?{subjects:[{...subjects.subjects[0],description:'已更新题目'}]}:subjects);
  if(path==='/api/courseware-quiz/quiz/40/my-submission')return state.historyFailure?new Response('',{status:503}):json({submit_times:1,submission:state.used?{id:60,quiz_id:40,submitted_times:state.used,submitted_at:null,submission_data:{subjects_answers:state.answers}}:null});
  if(path==='/course/10/content')return new Response(`<span id="userId" data-id="${state.userId}"></span>`);
  throw Error('Unexpected read '+path);
 });
 state.writer=new LmsWriter(state.reader,{session:state.session});return state;
}

test('each attachment has a distinct PPT todo and submission counts determine completion',()=>{
 const rows=quizRows(quizzes,references,entry,10);
 assert.deepEqual(rows.map(row=>row.state),['pending','submitted']);assert.equal(rows[0].title,'未答课件.pdf · PPT 答题');
 assert.notEqual(rows[0].id,rows[1].id);assert.notEqual(rows[0].id,'40');assert.equal(rows[0].activityId,'30');
 assert.throws(()=>quizRows(quizzes,{references:[{...references.references[0],parent_id:99}]},entry,10),/不一致/);
 assert.throws(()=>quizRows([...quizzes,quizzes[0]],references,entry,10),/编号/);
});

test('PPT scanning reads only published activities and preserves failed reads as unknown',async()=>{
 const state=fixture();const rows=await state.reader.pptHomeworks(10);assert.equal(rows.length,2);assert.equal(rows[1].state,'submitted');
 state.quizFailure=true;const failed=await state.reader.pptHomeworks(10);assert.equal(failed[0].state,'unknown');assert.equal(failed[0].detailError,true);
 assert.equal(state.writes.length,0);
});

test('fresh detail reads keep all subjects, exact course ownership and null submitted_at semantics',async()=>{
 const state=fixture(),detail=await state.reader.pptQuiz(10,30,40);assert.equal(detail.canSubmit,true);assert.equal(detail.subjects.length,1);
 await assert.rejects(()=>state.reader.pptQuiz(10,30,99),/未找到/);
 await assert.rejects(()=>state.reader.pptQuiz(99,30,40),/所学/);
 state.used=1;state.answers=answers;const done=await state.reader.pptQuiz(10,30,40);
 assert.equal(done.state,'submitted');assert.equal(done.canSubmit,false);assert.equal(done.answers[0].answer_option_ids[0],200);
});

test('preview resolves the selected quiz attachment and accepts only the school document servers',async()=>{
 const state=fixture(),preview=await state.reader.quizPreview(10,30,40);
 assert.equal(preview.title,'未答课件.pdf');assert.equal(preview.url,state.previewUrl);assert.equal(state.writes.length,0);
 await assert.rejects(()=>state.reader.quizPreview(10,30,99),/未找到/);
 for(const url of ['https://outside.example/deck.pdf','http://zy-media.bit.edu.cn/deck.pdf','https://user:secret@zy-media.bit.edu.cn/deck.pdf','https://zy-media.bit.edu.cn:8080/deck.pdf']){
  assert.throws(()=>quizPreviewUrl(url),/地址无效/);
 }
 state.previewUrl='https://outside.example/deck.pdf';await assert.rejects(()=>state.reader.quizPreview(10,30,40),/地址无效/);
});

test('answer validation rejects missing, duplicate, foreign and unsupported answers',()=>{
 const normalized=quizSubjects(subjects);assert.deepEqual(quizAnswers(normalized,answers),answers);
 assert.throws(()=>quizAnswers(normalized,[]),/全部/);
 assert.throws(()=>quizAnswers(normalized,[{...answers[0],answer_option_ids:[999]}]),/有效/);
 assert.throws(()=>quizAnswers(normalized,[{...answers[0],answer_option_ids:[200,200]}]),/有效/);
 const unsupported=quizSubjects({subjects:[{id:100,type:'analysis',description:'组合题',options:[]}]});
 assert.equal(unsupported[0].supported,false);assert.throws(()=>quizAnswers(unsupported,[{...answers[0],type:'analysis'}]),/变化/);
});

test('a successful quiz POST is confirmed by the stored complete answer set',async()=>{
 const state=fixture(),before=await state.reader.pptQuiz(10,30,40),payload={requestId:'ppt-request-0001',version:before.version,answers};
 assert.equal((await state.writer.submitQuiz(10,30,40,payload)).status,'submitted');assert.deepEqual(state.writes,[{subjects_answers:answers}]);
 const restarted=new LmsWriter(state.reader,{session:state.session});assert.equal((await restarted.submitQuiz(10,30,40,payload)).status,'submitted');assert.equal(state.writes.length,1);
});

test('changed questions block a write and ambiguous submission cannot be resent with a new request id',async()=>{
 const state=fixture(),before=await state.reader.pptQuiz(10,30,40),payload={requestId:'ppt-request-0002',version:before.version,answers};
 state.changed=true;await assert.rejects(()=>state.writer.submitQuiz(10,30,40,payload),/题目已更新/);assert.equal(state.writes.length,0);
 state.changed=false;state.disconnect=true;assert.equal((await state.writer.submitQuiz(10,30,40,payload)).status,'uncertain');assert.equal(state.writes.length,1);
 state.historyFailure=false;state.used=0;state.answers=[];
 const restarted=new LmsWriter(state.reader,{session:state.session});
 assert.equal((await restarted.submitQuiz(10,30,40,{...payload,requestId:'ppt-request-0003'})).status,'uncertain');assert.equal(state.writes.length,1);
 state.used=1;state.answers=answers;assert.equal((await restarted.submitQuiz(10,30,40,{...payload,requestId:'ppt-request-0004'})).status,'submitted');assert.equal(state.writes.length,1);
});
