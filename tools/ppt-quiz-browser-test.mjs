import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {installSignedOutRecoveryFixture} from './signed-out-recovery-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),scratch=await mkdtemp(join(tmpdir(),'yanhe-ppt-quiz-'));
const extension=join(scratch,'extension'),output=join(root,'test-results');await mkdir(output,{recursive:true});
await cp(resolve(process.env.EXTENSION_PATH||join(root,'extension')),extension,{recursive:true});
await writeFile(join(extension,'build-info.json'),JSON.stringify({version:'1.10.3',catalog:null}));
await writeFile(join(extension,'bundled-catalogs.json'),JSON.stringify({schema:1,catalogs:{}}));
await installSignedOutRecoveryFixture(extension);
const contentPath=join(extension,'content.js');
const clipboardFixture=`
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
 const mode=document.documentElement.dataset.fixtureClipboard;
 if(mode==='fallback'||mode==='blocked')throw new DOMException('Fixture clipboard unavailable','NotAllowedError');
 document.documentElement.dataset.fixtureCopied=value;
}}});
const originalExecCommand=document.execCommand.bind(document);
document.execCommand=command=>{
 if(command!=='copy')return originalExecCommand(command);
 if(document.documentElement.dataset.fixtureClipboard==='blocked')return false;
 let active=document.activeElement;
 while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
 document.documentElement.dataset.fixtureCopied=active?.value||'';
 document.documentElement.dataset.fixtureCopyFallback='true';
 return true;
};
`;
await writeFile(contentPath,clipboardFixture+await readFile(contentPath,'utf8'));
const report={mode:'isolated Edge, synthetic APIs, answers and clipboard; no real course submissions or system clipboard changes',checks:[]};
const material={id:30,course_id:10,type:'material',title:'合成课件活动',published:true,is_in_progress:true,submit_times:1};
const questions=[
 {id:100,type:'single_selection',description:'<p>单选题 $V^* = \\max_a Q(a)$</p><p>补充&nbsp;说明<br>第二行</p>',options:[{id:200,sort:0,content:'<p>选项一 &amp; 条件</p>'},{id:201,sort:1,content:'选项二'}]},
 {id:101,type:'multiple_selection',description:'多选题',options:[{id:202,sort:0,content:'多选一'},{id:203,sort:1,content:'多选二'}]},
 {id:102,type:'true_or_false',description:'判断题',options:[{id:204,sort:0,content:'正确'},{id:205,sort:1,content:'错误'}]},
 {id:103,type:'fill_in_blank',answer_number:2,description:'填空题',options:[]},
 {id:104,type:'short_answer',description:'简答题',options:[]}
].map((row,sort)=>({...row,sort}));
function syntheticPdf(){
 const count=12,kids=Array.from({length:count},(_,index)=>`${4+index*2} 0 R`).join(' ');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(let page=1;page<=count;page++){
  const stream=`BT /F1 28 Tf 50 310 Td (Synthetic courseware - page ${page}) Tj ET\n`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+(page-1)*2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
 }
 let source='%PDF-1.7\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(source));source+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(source);source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 source+=offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 source+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(source);
}
const pdfBytes=syntheticPdf();
let used=0,submitted=[],posts=0,context,page,previewBlocked=false;
try{
 context=await chromium.launchPersistentContext(join(scratch,'profile'),{executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1440,height:1050}});
 context.setDefaultTimeout(20000);
 await context.addCookies([{name:'_token',value:'eyJfixture.ppt.signature',domain:'aita.yanhekt.cn',path:'/',secure:true}]);
 const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(request.method()==='POST'){
   assert.equal(url.hostname,'zy-eclass.bit.edu.cn');assert.equal(path,'/api/courseware-quiz/quiz/40/submissions');
   const body=request.postDataJSON();assert.equal(body.subjects_answers.length,5);
   assert.deepEqual(body.subjects_answers[1].answer_option_ids,[202,203]);
   assert.deepEqual(body.subjects_answers[3].answers,[{sort:0,content:'填空一'},{sort:1,content:'填空二'}]);
   posts++;used++;submitted=body.subjects_answers;return json({});
  }
  assert.equal(request.method(),'GET');
  if(url.hostname==='zy-media.bit.edu.cn'){
   assert.equal(path,'/download/file/fixture.pdf');
   return route.fulfill({contentType:'application/pdf',headers:{'Accept-Ranges':'bytes'},body:pdfBytes});
  }
  if(url.hostname==='zy-eclass.bit.edu.cn'){
   if(path==='/api/my-courses')return json({courses:[{id:10,name:'合成 PPT 课程',academic_year:{name:'2026-2027'},semester:{name:'第一学期'}}]});
   if(path==='/api/course/10/courseware-activities')return json([material]);
   if(path==='/api/courses/10/homework-activities')return json({page:1,pages:1,homework_activities:[{id:20,course_id:10,type:'homework',title:'普通作业',published:true,submitted:false}]});
   if(path.endsWith('/submission-status'))return json({homework_activities:[]});
   if(path==='/api/activities/30')return json(material);
   if(path==='/api/courseware-quiz/activity/30/quizzes')return json([{id:40,subjects_count:5,submitted_times:used,upload_reference_id:400},{id:41,subjects_count:1,submitted_times:1,upload_reference_id:401}]);
   if(path==='/api/activities/30/upload_references')return json({references:[{id:400,parent_id:30,name:'未答课件.pdf'},{id:401,parent_id:30,name:'已答课件.pdf'}]});
   if(/^\/api\/uploads\/reference\/document\/40[01]\/url$/.test(path))return previewBlocked?route.fulfill({status:503,body:''}):json({status:'ready',url:'https://zy-media.bit.edu.cn/download/file/fixture.pdf?signature=synthetic'});
   if(path.endsWith('/quiz/40/subjects'))return json({subjects:questions});
   if(path.endsWith('/quiz/41/subjects'))return json({subjects:questions.slice(0,1)});
   if(path.endsWith('/quiz/40/my-submission'))return json({submit_times:1,submission:used?{id:60,quiz_id:40,submitted_times:used,submission_data:{subjects_answers:submitted}}:null});
   if(path.endsWith('/quiz/41/my-submission'))return json({submit_times:1,submission:{id:61,quiz_id:41,submitted_times:1,submitted_at:null,submission_data:{subjects_answers:[{subject_id:100,type:'single_selection',answer_option_ids:[201],answers:[]}]}}});
   if(path==='/course/10/content')return route.fulfill({contentType:'text/html',body:'<span id="userId" data-id="7"></span>'});
   throw Error('Unexpected LMS read '+path);
  }
  if(url.hostname==='lexue.bit.edu.cn'||url.hostname==='cbiz.yanhekt.cn')return route.fulfill({status:401,body:''});
  if(url.hostname==='aita.yanhekt.cn'){
   if(path.endsWith('infosimple'))return json({code:200,params:{id:7,tenant_id:21,account:'fixture'}});
   if(path.endsWith('/account-profile/course'))return json({code:1000,params:{result:{data:[],total:0}}});
   if(path.endsWith('/get-my-course-day'))return json({code:0,list:{}});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Native shell</body></html>'});
  }
  throw Error('Unexpected host '+url.hostname);
 });
 page=await context.newPage();await page.goto('https://aita.yanhekt.cn/personal/?yh_view=tasks&yh_source=lms');
 await page.locator('.task-row').filter({hasText:'未答课件.pdf'}).waitFor();
 assert.equal(await page.locator('.task-row').count(),2);assert.equal(await page.locator('.task-row').filter({hasText:'已答课件.pdf'}).count(),0);
 report.checks.push('PPT quizzes join ordinary assignments while already answered attachments are absent from pending tasks');
 await page.getByRole('button',{name:'未答课件.pdf · PPT 答题',exact:true}).click();
 await page.locator('.ppt-quiz-card').last().waitFor();assert.equal(await page.locator('.ppt-quiz-card').count(),5);
 assert.equal(await page.locator('.ppt-quiz-card math').count(),1);assert.equal(posts,0);
 const firstQuestion='1. 单选题\n单选题 $V^* = \\max_a Q(a)$\n补充 说明\n第二行\nA. 选项一 & 条件\nB. 选项二';
 const allQuestions=[firstQuestion,'2. 多选题\n多选题\nA. 多选一\nB. 多选二','3. 判断题\n判断题\nA. 正确\nB. 错误','4. 填空题\n填空题','5. 简答题\n简答题'].join('\n\n');
 await page.getByRole('button',{name:'复制第 1 题',exact:true}).click();
 await page.getByText('已复制第 1 题',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopied),firstQuestion);
 assert.equal(await page.locator('.dialog-heading .ppt-copy-all').count(),1);
 report.checks.push('a small button beside each number copies question text and options, preserving TeX and paragraph breaks');
 const preview=page.frameLocator('iframe[title="原课件预览"]');
 await preview.locator('.document-page canvas[data-rendered=true]').first().waitFor();await preview.getByText('/ 12',{exact:true}).waitFor();
 assert.equal(await preview.locator('.document-page').count(),12);assert.ok(await preview.locator('canvas').count()<12);
 assert.ok(await preview.locator('canvas').first().evaluate(canvas=>canvas.width>100&&canvas.height>100));
 assert.ok(await preview.locator('canvas[data-rendered=true]').first().evaluate(canvas=>{
  const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  for(let index=0;index<data.length;index+=4)if(data[index]<100&&data[index+1]<100&&data[index+2]<100&&data[index+3]>0)return true;
  return false;
 }));
 const paneBounds=await page.locator('.ppt-document-pane').boundingBox(),questionBounds=await page.locator('.ppt-question-pane').boundingBox();
 assert.ok(paneBounds.x+paneBounds.width<=questionBounds.x+2);
 await preview.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await preview.getByLabel('课件页码',{exact:true}).inputValue(),'2');
 await preview.getByLabel('课件缩放',{exact:true}).selectOption('1.5');
 await preview.locator('.document-page canvas[data-rendered=true]').first().waitFor();await preview.getByLabel('课件缩放',{exact:true}).selectOption('fit');
 report.checks.push('the selected attachment renders beside the questions with page navigation, zoom and bounded canvases for a twelve-page PDF');
 await page.locator('.ppt-quiz-card').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:join(output,'ppt-quiz-top.png'),fullPage:true});
 await page.setViewportSize({width:375,height:850});
 assert.equal(await page.locator('#resources-dialog').evaluate(dialog=>dialog.scrollWidth>dialog.clientWidth+1),false);
 await page.getByLabel('1 题选项 1',{exact:true}).check();
 await page.getByRole('button',{name:'课件',exact:true}).click();assert.equal(await page.locator('.ppt-question-pane').isVisible(),false);
 assert.equal(await page.locator('.ppt-document-pane').isVisible(),true);
 await preview.getByLabel('课件页码',{exact:true}).fill('8');await preview.getByLabel('课件页码',{exact:true}).press('Tab');
 await preview.locator('.document-page[aria-label="第 8 页"] canvas[data-rendered=true]').waitFor();
 await page.getByRole('button',{name:'答题',exact:true}).click();assert.equal(await page.getByLabel('1 题选项 1',{exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'课件',exact:true}).click();assert.equal(await preview.getByLabel('课件页码',{exact:true}).inputValue(),'8');
 await page.getByRole('button',{name:'答题',exact:true}).click();
 await page.screenshot({path:join(output,'ppt-quiz-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1050});
 previewBlocked=true;await preview.getByRole('button',{name:'刷新课件',exact:true}).click();await preview.getByRole('button',{name:'重新加载课件',exact:true}).waitFor();
 assert.equal(await page.getByLabel('1 题选项 1',{exact:true}).isChecked(),true);
 previewBlocked=false;await preview.getByRole('button',{name:'重新加载课件',exact:true}).click();await preview.locator('canvas[data-rendered=true]').first().waitFor();
 report.checks.push('mobile pane switching and retrying a failed preview preserve entered answers');
 await page.getByLabel('1 题选项 1',{exact:true}).check();await page.getByLabel('2 题选项 1',{exact:true}).check();await page.getByLabel('2 题选项 2',{exact:true}).check();
 await page.getByLabel('3 题选项 1',{exact:true}).check();await page.getByLabel('4 题答案 1',{exact:true}).fill('填空一');await page.getByLabel('4 题答案 2',{exact:true}).fill('填空二');
 assert.equal(await page.getByRole('button',{name:'提交全部答案',exact:true}).isEnabled(),false);
 await page.getByLabel('5 题答案 1',{exact:true}).fill('合成简答');
 assert.equal(await page.getByRole('button',{name:'提交全部答案',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'复制全部题目',exact:true}).click();
 await page.getByText('已复制全部 5 道题目',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopied),allQuestions);
 await page.evaluate(()=>{document.documentElement.dataset.fixtureClipboard='fallback';});
 await page.getByRole('button',{name:'复制第 4 题',exact:true}).click();
 await page.getByText('已复制第 4 题',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopyFallback),'true');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopied),'4. 填空题\n填空题');
 assert.equal(await page.getByLabel('4 题答案 1',{exact:true}).inputValue(),'填空一');
 assert.equal(await page.getByLabel('5 题答案 1',{exact:true}).inputValue(),'合成简答');
 assert.equal(await page.locator('.ppt-clipboard-buffer').count(),0);
 await page.evaluate(()=>{document.documentElement.dataset.fixtureClipboard='blocked';});
 await page.getByRole('button',{name:'复制第 5 题',exact:true}).click();
 await page.getByText('复制失败，请重试',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.getByRole('button',{name:'复制第 5 题',exact:true}).isEnabled(),true);
 await page.evaluate(()=>{delete document.documentElement.dataset.fixtureClipboard;});
 await page.getByRole('button',{name:'复制第 5 题',exact:true}).click();
 await page.getByText('已复制第 5 题',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopied),'5. 简答题\n简答题');
 assert.equal(posts,0);
 report.checks.push('top copy-all excludes entered answers, fallback keeps form values, failed copies recover and copying never submits');
 await page.screenshot({path:join(output,'ppt-quiz-expanded.png'),fullPage:true});
 report.checks.push('all five questions stay expanded, formulas use MathML, and single/multiple/judgment/fill/text inputs keep independent answers');
 await page.getByRole('button',{name:'提交全部答案',exact:true}).click();await page.getByText('答题已提交',{exact:true}).waitFor();
 assert.equal(posts,1);assert.equal(await page.locator('.ppt-quiz-option input:disabled').count(),6);
 const detached=page.waitForEvent('framedetached',{predicate:frame=>frame.url().includes('courseware-viewer.html')});
 await page.getByRole('button',{name:'关闭',exact:true}).click();await detached;
 assert.equal(await page.locator('.ppt-copy-all,.ppt-copy-feedback').count(),0);
 await page.waitForFunction(()=>document.querySelector('#yanhe-refine').shadowRoot.querySelectorAll('.task-row').length===1);
 assert.equal(page.frames().filter(frame=>frame.url().includes('courseware-viewer.html')).length,0);
 report.checks.push('one explicit submit sends the full answer set and verified completion removes the quiz from pending tasks');
 await page.getByLabel('提交状态',{exact:true}).selectOption('submitted');
 await page.getByRole('button',{name:'已答课件.pdf · PPT 答题',exact:true}).click();await page.locator('.ppt-quiz-card').waitFor();
 assert.equal(await page.getByLabel('1 题选项 2',{exact:true}).isChecked(),true);
 assert.equal(await page.getByLabel('1 题选项 2',{exact:true}).isDisabled(),true);assert.equal(posts,1);
 assert.equal(await page.locator('.ppt-copy-all').count(),1);
 await page.getByRole('button',{name:'复制全部题目',exact:true}).click();
 await page.getByText('已复制全部 1 道题目',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.fixtureCopied),firstQuestion);
 report.checks.push('submitted questions remain copyable and header copy controls are removed when the dialog closes');
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();
 await page.getByRole('button',{name:'已答课件.pdf · PPT 答题',exact:true}).waitFor();
 report.checks.push('submitted filtering, saved answers and exhausted attempts survive reload without an automatic write');
 assert.deepEqual(errors,[]);report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack);process.exitCode=1;if(page){report.visible=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:join(output,'ppt-quiz-failed.png'),fullPage:true}).catch(()=>{});}}
finally{await context?.close();if(dirname(scratch)===resolve(tmpdir())&&basename(scratch).startsWith('yanhe-ppt-quiz-'))await rm(scratch,{recursive:true,force:true});await writeFile(join(output,'ppt-quiz-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
