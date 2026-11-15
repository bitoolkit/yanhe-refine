import test from 'node:test';
import assert from 'node:assert/strict';
import {quizDraft} from '../src/quiz-drafts.js';

const row={courseId:'10',activityId:'30',quizId:'40'};
const data={userId:'7',version:'question version 1',used:0};
const answers=[{subject_id:100,answer_option_ids:[200],answers:[]}];
function memory(){
 const values={};
 return {values,get:async key=>key===null?{...values}:{[key]:values[key]},set:async value=>Object.assign(values,value),remove:async keys=>{for(const key of [keys].flat())delete values[key];}};
}

test('quiz drafts restore per account and question version, then clear in write order',async()=>{
 const storage=memory(),draft=await quizDraft(row,data,storage);
 assert.equal(draft.answers,null);
 await draft.save(answers);
 assert.deepEqual((await quizDraft(row,data,storage)).answers,answers);
 for(const change of [{userId:'8'},{version:'changed'},{used:1}])assert.equal((await quizDraft(row,{...data,...change},storage)).answers,null);
 const saving=draft.save(answers),clearing=draft.clear();await Promise.all([saving,clearing]);
 assert.equal((await quizDraft(row,data,storage)).answers,null);
});

test('quiz drafts preserve unfinished courses and long text, and surface storage errors',async()=>{
 const storage=memory();
 for(let id=1;id<=14;id++)await (await quizDraft({...row,quizId:String(id)},data,storage)).save(answers);
 assert.equal(Object.keys(storage.values).length,14);
 const draft=await quizDraft(row,data,storage);
 const longAnswer=[{content:'字'.repeat(100000)}];await draft.save(longAnswer);
 assert.deepEqual((await quizDraft(row,data,storage)).answers,longAnswer);
 const unavailable={get:async()=>{throw new Error('storage unavailable');},set:async()=>{throw new Error('storage unavailable');}};
 const editor=await quizDraft(row,data,unavailable);assert.equal(editor.answers,null);
 await assert.rejects(editor.save(answers),/storage unavailable/);
});
