import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {installSignedOutRecoveryFixture} from './signed-out-recovery-fixture.mjs';
import {currentTeachingTerm} from '../src/teaching-terms.js';
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'yanhe-settings-')),ext=join(scratch,'extension'),out=join(root,'test-results');
await cp(resolve(process.env.EXTENSION_PATH||join(root,'extension')),ext,{recursive:true});await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));await writeFile(join(ext,'build-info.json'),JSON.stringify({version:manifest.version,catalog:null}));
await writeFile(join(ext,'bundled-catalogs.json'),JSON.stringify({schema:1,catalogs:{}}));
await installSignedOutRecoveryFixture(ext);
const nextParts=manifest.version.split('.').map(Number);nextParts[nextParts.length-1]++;const nextVersion=nextParts.join('.');
const report={mode:'isolated Edge; synthetic GitHub releases and platform responses; no real account requests',checks:[]};let context,page,phase='new',releasePending,releaseOld;
let oldPhase='slow';
const term=currentTeachingTerm(),[firstYear,lastYear,semester]=term.split('-'),deadline=Date.now()+3*86400000;
const previousTerm=`${Number(firstYear)-1}-${firstYear}-${semester}`,calendarReads=[];
const moodleDate=new Date(deadline+86400000+8*3600000).toISOString().slice(0,16).replace('T',' ');
try{
 assert.ok(manifest.host_permissions.includes('https://api.github.com/*'));assert.ok(!manifest.host_permissions.some(value=>value.includes('share.ruc.edu.kg')));
 context=await chromium.launchPersistentContext(join(scratch,'profile'),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],viewport:{width:1440,height:1080}});context.setDefaultTimeout(15000);
 let checks=0;const errors=[];
 await context.addCookies([{name:'_token',value:'eyJfixture.settings.signature',domain:'aita.yanhekt.cn',path:'/',secure:true}]);
 await context.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url());assert.ok(request.method()==='GET'||(url.hostname==='lexue.bit.edu.cn'&&url.pathname==='/lib/ajax/service.php'&&request.method()==='POST'));
  const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(url.hostname==='aita.yanhekt.cn'&&url.pathname.endsWith('/infosimple'))return json({code:200,params:{id:7,tenant_id:21,phone:'fixture',account:'fixture'}});
  if(url.hostname==='aita.yanhekt.cn'&&url.pathname.endsWith('/account-profile/course'))return json({code:1000,params:{result:{data:[],total:0}}});
  if(url.hostname==='zy-eclass.bit.edu.cn'){
   if(url.pathname==='/api/my-courses')return json({courses:[{id:10,name:'合成日历课程',academic_year:`${firstYear}-${lastYear}`,semester:{real_name:`第${semester}学期`}},{id:11,name:'往年课程',academic_year:`${Number(firstYear)-1}-${firstYear}`,semester:{real_name:`第${semester}学期`}}]});
   if(url.pathname.startsWith('/api/course/10/')||url.pathname.startsWith('/api/courses/10/')){
    calendarReads.push('lms:10');
    if(url.pathname.endsWith('/courseware-activities'))return json([]);
    if(url.pathname.endsWith('/submission-status'))return json({homework_activities:[]});
    if(url.pathname.endsWith('/homework-activities'))return json({page:1,pages:1,homework_activities:[
     {id:20,course_id:10,title:'合成待办',published:true,submitted:false,deadline},
     {id:21,course_id:10,title:'已交作业',published:true,submitted:true,deadline},
     {id:22,course_id:10,title:'过期作业',published:true,submitted:false,deadline:Date.now()-86400000},
     {id:23,course_id:10,title:'无截止时间',published:true,submitted:false}
    ]});
   }
   throw Error('Unexpected LMS calendar request '+url.pathname);
  }
  if(url.hostname==='sso.bit.edu.cn')return route.fulfill({contentType:'text/html',body:'<h1>Login required</h1>'});
  if(url.hostname==='lexue.bit.edu.cn'){
   if(oldPhase==='slow')await new Promise(resolve=>releaseOld=resolve);
   if(oldPhase==='failed')return route.fulfill({status:503,contentType:'text/html',body:'Unavailable'});
   if(url.pathname==='/my/')return route.fulfill({contentType:'text/html',body:'<!doctype html><script>M.cfg={"wwwroot":"https://lexue.bit.edu.cn","sesskey":"settingsFixture123"};</script>'});
   if(url.pathname==='/lib/ajax/service.php'){assert.equal(request.postDataJSON()[0].methodname,'core_course_get_enrolled_courses_by_timeline_classification');return json([{error:false,data:{courses:[{id:201,fullname:term+' 合成旧乐学'},{id:202,fullname:previousTerm+' 往年旧乐学'}],nextoffset:0}}]);}
   if(url.pathname==='/course/view.php'&&url.searchParams.get('id')==='201'){
    calendarReads.push('lexue:201');return route.fulfill({contentType:'text/html',body:'<body class="course-201"><main id="region-main"><li class="activity modtype_assign" id="module-301"><div class="activityinstance"><a href="/mod/assign/view.php?id=301"><span class="instancename">合成旧乐学待办</span></a></div></li></main></body>'});
   }
   if(url.pathname==='/mod/assign/view.php'&&url.searchParams.get('id')==='301')return route.fulfill({contentType:'text/html',body:`<body><main id="region-main"><div id="intro">合成题目</div><table class="submissionstatustable"><tr><td>提交状态</td><td>未提交</td></tr><tr><td>截止时间</td><td>${moodleDate}</td></tr></table></main></body>`});
   throw Error('Unexpected old LMS path '+url.pathname);
  }
  if(url.hostname==='api.github.com'){
   assert.equal(url.pathname,'/repos/bitoolkit/yanhe-refine/releases/latest');assert.equal(request.headers().authorization,undefined);assert.equal(request.headers().cookie,undefined);checks++;
   if(phase==='offline')return route.abort();if(phase==='limited')return route.fulfill({status:403,body:'{}'});
   if(phase==='new')await new Promise(resolve=>releasePending=resolve);
   const version=manifest.version,name='yanhe-refine-'+version+'-20261030.zip';
   return route.fulfill({contentType:'application/json',body:JSON.stringify({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name,state:'uploaded',browser_download_url:'https://github.com/bitoolkit/yanhe-refine/releases/download/v'+version+'/'+name}]})});
  }
  assert.notEqual(url.hostname,'share.ruc.edu.kg');
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Native fixture</body></html>'});
 });
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('https://aita.yanhekt.cn/personal/?yh_view=settings');
 const check=page.locator('#plugin-update');await check.waitFor();assert.equal(checks,0);
 assert.equal(await page.getByRole('heading',{name:'时间',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'导出待办日历',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'检查更新',exact:true}).count(),0);
 assert.equal(await page.getByRole('heading',{name:'延河焕新',exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'插件更新',exact:true}).count(),0);
 const project=page.getByRole('link',{name:'项目仓库',exact:true});assert.equal(await project.count(),1);assert.equal(await project.getAttribute('href'),'https://github.com/bitoolkit/yanhe-refine');assert.equal(await page.getByRole('link',{name:'发布页',exact:true}).count(),0);
 const auto=page.getByRole('link',{name:'Yanhekt-AutoSlides',exact:true}),share=page.getByRole('link',{name:'BITShare · 资料分享站',exact:true});
 assert.equal(await auto.getAttribute('href'),'https://github.com/bit-admin/Yanhekt-AutoSlides');assert.equal(await share.getAttribute('href'),'https://bitshare.com.cn/');assert.equal(await auto.getAttribute('target'),'_blank');assert.equal(await share.getAttribute('target'),'_blank');
 report.checks.push('settings show both requested friend links without requesting either site automatically');
 await check.click();await page.locator('#update-status').filter({hasText:'正在检查更新'}).waitFor();assert.equal(await check.isDisabled(),true);
 await page.waitForTimeout(100);assert.equal(typeof releasePending,'function');releasePending();await page.locator('#update-status').filter({hasText:'已是最新发布版'}).waitFor();
 assert.equal(checks,1);assert.equal(context.pages().length,2);
 report.checks.push('one settings button checks for updates in place, suppresses duplicate clicks and keeps the same tab');
 phase='same';await check.click();await page.locator('#update-status').filter({hasText:'已是最新发布版'}).waitFor();assert.equal(await page.getByRole('link',{name:'下载新版',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'发布页',exact:true}).count(),0);assert.equal(await project.isVisible(),true);
 phase='limited';await check.click();await page.locator('#update-status').filter({hasText:'暂时受限'}).waitFor();
 phase='offline';await check.click();await page.locator('#update-status').filter({hasText:'连接失败'}).waitFor();assert.equal(await check.isDisabled(),false);
 assert.equal(await page.getByRole('link',{name:'发布页',exact:true}).count(),0);
 phase='same';await check.click();await page.locator('#update-status').filter({hasText:'已是最新发布版'}).waitFor();assert.equal(await page.getByRole('link',{name:'发布页',exact:true}).count(),0);report.checks.push('the same button retries network and rate-limit errors without opening a separate update page');
 const connections=page.locator('.connection-entry');assert.equal(await connections.count(),4);assert.equal(await page.locator('.connection-entry[data-state="unknown"]').count(),4);
 assert.equal(await page.locator('.connection-setting details').count(),0);
 const connectionCheck=page.getByRole('button',{name:'检查连接',exact:true});await connectionCheck.click();
 const busyCheck=page.getByRole('button',{name:'检查中…',exact:true});await busyCheck.waitFor();assert.equal(await busyCheck.isDisabled(),true);
 const modern=page.getByRole('link',{name:'新延河',exact:true}),legacy=page.getByRole('link',{name:'旧延河',exact:true}),newLms=page.getByRole('link',{name:'新乐学',exact:true}),oldLms=page.getByRole('link',{name:'旧乐学',exact:true});
 await modern.locator('.connection-state').filter({hasText:'已连接'}).waitFor();await newLms.locator('.connection-state').filter({hasText:'已连接'}).waitFor();await legacy.locator('.connection-state').filter({hasText:'需验证'}).waitFor();
 assert.equal(await oldLms.getAttribute('data-state'),'checking');assert.equal(await oldLms.getAttribute('href'),'https://lexue.bit.edu.cn/my/');assert.equal(new URL(await legacy.getAttribute('href')).searchParams.get('yh_native'),'1');assert.equal(new URL(await legacy.getAttribute('href')).searchParams.has('yh_mode'),false);assert.equal(await legacy.getAttribute('target'),'_blank');
 assert.equal(typeof releaseOld,'function');oldPhase='failed';releaseOld();await oldLms.locator('.connection-state').filter({hasText:'读取失败'}).waitFor();await connectionCheck.waitFor();assert.equal(await connectionCheck.isDisabled(),false);
 const colors=await connections.evaluateAll(rows=>rows.map(row=>getComputedStyle(row.querySelector('.connection-state')).color));assert.equal(new Set(colors).size,3);
 const marker=oldLms.locator('.connection-marker');assert.equal(await marker.getAttribute('aria-hidden'),'true');assert.equal(await oldLms.getAttribute('aria-describedby'),'connection-lexue');
 report.checks.push('four platform links show independent progress, green success, orange login and red read failure, with text labels and no expandable reason');
 const desktopBoxes=await connections.evaluateAll(rows=>rows.map(row=>{const box=row.getBoundingClientRect(),name=row.querySelector('.connection-name').getBoundingClientRect(),status=row.querySelector('.connection-state').getBoundingClientRect();return {top:box.top,width:box.width,height:box.height,inline:status.left>=name.right};}));
 assert.ok(desktopBoxes.every(box=>box.top===desktopBoxes[0].top&&box.width<160&&box.height<48&&box.inline));
 const checkBox=await connectionCheck.boundingBox();assert.ok(Math.abs(checkBox.y-desktopBoxes[0].top)<4);
 await page.screenshot({path:join(out,'settings-update-desktop.png'),fullPage:true});await page.locator('.connection-setting').screenshot({path:join(out,'settings-connection-compact.png')});await page.setViewportSize({width:375,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(out,'settings-update-mobile.png'),fullPage:true});
 assert.equal(await page.locator('.connection-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
 oldPhase='healthy';await page.waitForTimeout(3100);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await oldLms.locator('.connection-state').filter({hasText:'已连接'}).waitFor();await connectionCheck.waitFor();
 assert.equal(await page.locator('.connection-entry[data-state="checking"]').count(),0);report.checks.push('returning to the visible settings page automatically rechecks failed platforms without another click, clears every loading indicator, and keeps two columns on narrow screens');
 const calendarButton=page.getByRole('button',{name:'导出待办日历',exact:true});
 const savedCalendar=page.waitForEvent('download');await calendarButton.click();const calendar=await savedCalendar;
 const calendarText=(await readFile(await calendar.path(),'utf8')).replace(/\r\n /g,'');
 await page.getByText('已导出 2 项',{exact:true}).waitFor();
 assert.ok(calendar.suggestedFilename().endsWith('.ics'));assert.match(calendarText,/合成待办/);assert.match(calendarText,/合成旧乐学待办/);
 for(const excluded of ['已交作业','过期作业','无截止时间','往年课程','往年旧乐学'])assert.ok(!calendarText.includes(excluded));
 assert.ok(calendarReads.includes('lms:10')&&calendarReads.includes('lexue:201'));
 report.checks.push('one settings button exports an ICS file for both current-semester LMS platforms, excluding completed, overdue and undated tasks; the Time row is removed');
 oldPhase='failed';const partialDownload=page.waitForEvent('download');await calendarButton.click();await partialDownload;
 await page.getByText('已导出 1 项 · 部分待办未同步',{exact:true}).waitFor();oldPhase='healthy';
 report.checks.push('a failed LMS still allows available deadlines to export with an explicit partial-sync message');
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'desk:update-status':{stage:'downloading',text:'正在下载更新…',version:chrome.runtime.getManifest().version}}));
 await page.locator('#update-status').filter({hasText:'正在下载更新'}).waitFor();assert.equal(await check.isDisabled(),true);
 await page.reload();await check.waitFor();
 await page.locator('#update-status').filter({hasText:'上次更新已停止'}).waitFor();assert.equal(await check.isDisabled(),false);
 report.checks.push('opening settings reconciles a simulated interrupted-update status and makes the same button retryable');
 assert.deepEqual(errors,[]);report.checks.push('desktop and 375px settings render without horizontal overflow or page errors');report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack);process.exitCode=1;await page?.screenshot({path:join(out,'settings-update-failed.png'),fullPage:true}).catch(()=>{});}
finally{await context?.close();if(dirname(resolve(scratch))===resolve(tmpdir())&&basename(scratch).startsWith('yanhe-settings-'))await rm(scratch,{recursive:true,force:true});await writeFile(join(out,'settings-update-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
