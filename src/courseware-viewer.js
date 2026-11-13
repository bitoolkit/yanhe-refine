import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {RemoteLms} from './remote-client.js';

GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('pdfjs/pdf.worker.mjs');
const $=id=>document.getElementById(id),viewport=$('pages'),parameters=new URLSearchParams(location.search);
const courseId=parameters.get('course'),activityId=parameters.get('activity'),quizId=parameters.get('quiz');
const original=new URL(`https://zy-eclass.bit.edu.cn/course/${courseId}/learning-activity`);original.hash='/'+activityId;$('original').href=original.href;
let loadingTask,pdf,observer,resizeFrame,scrollFrame,revision=0,firstWidth=1,firstHeight=1,currentPage=1,previousWidth=0;
let pages=[];const visible=new Set();

function releasePage(entry){
 entry.revision++;entry.task?.cancel();entry.task=null;
 if(entry.canvas){entry.canvas.width=0;entry.canvas.height=0;entry.canvas.remove();entry.canvas=null;}
 entry.page?.cleanup();entry.page=null;
}
function releaseDocument(){
 observer?.disconnect();observer=null;visible.clear();pages.forEach(releasePage);pages=[];viewport.replaceChildren();
 const task=loadingTask;loadingTask=null;pdf=null;return task?.destroy().catch(()=>{});
}
function pageWidth(){return $('zoom').value==='fit'?Math.max(100,viewport.clientWidth-26):firstWidth*Number($('zoom').value);}
function updateNavigation(){
 if(document.activeElement!==$('page'))$('page').value=String(currentPage);
 $('previous').disabled=!pdf||currentPage<=1;$('next').disabled=!pdf||currentPage>=pages.length;
}
function updateCurrentPage(){
 if(!pdf||!viewport.clientWidth||!viewport.clientHeight)return;
 const top=viewport.getBoundingClientRect().top+30;
 const nearest=[...visible].sort((a,b)=>Math.abs(a.element.getBoundingClientRect().top-top)-Math.abs(b.element.getBoundingClientRect().top-top))[0];
 if(nearest){currentPage=nearest.number;updateNavigation();}
}
async function renderPage(entry){
 if(!pdf||entry.canvas||entry.loading||!visible.has(entry))return;
 const loadedDocument=pdf,version=entry.revision;entry.loading=true;
 try{
  const page=await loadedDocument.getPage(entry.number);
  if(loadedDocument!==pdf||version!==entry.revision||!visible.has(entry)){page.cleanup();return;}
  entry.page=page;
  const natural=page.getViewport({scale:1}),width=pageWidth(),view=page.getViewport({scale:width/natural.width});
  entry.element.style.aspectRatio=`${natural.width} / ${natural.height}`;
  const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(8000000/(view.width*view.height)));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width*ratio);canvas.height=Math.ceil(view.height*ratio);
  canvas.setAttribute('aria-label',`第 ${entry.number} 页`);canvas.setAttribute('role','img');entry.canvas=canvas;entry.element.append(canvas);
  entry.task=page.render({canvasContext:canvas.getContext('2d'),viewport:view,transform:[ratio,0,0,ratio,0,0]});
  await entry.task.promise;
  if(version===entry.revision&&entry.canvas===canvas)canvas.dataset.rendered='true';
 }catch(error){
  if(version===entry.revision&&error.name!=='RenderingCancelledException'){
   releasePage(entry);entry.element.setAttribute('aria-label',`第 ${entry.number} 页暂未加载，请重新加载课件`);
  }
 }finally{
  entry.loading=false;
  if(version!==entry.revision&&visible.has(entry)&&pdf)void renderPage(entry);
 }
}
function resizePages(){
 if(!pdf)return;
 const width=pageWidth();
 for(const entry of pages){releasePage(entry);entry.element.style.width=width+'px';}
 for(const entry of visible)void renderPage(entry);
}
function goToPage(number){
 const value=Math.max(1,Math.min(pages.length,Math.trunc(Number(number))||1));
 pages[value-1]?.element.scrollIntoView({block:'start'});currentPage=value;$('page').value=String(value);updateNavigation();
}
async function load(){
 const version=++revision,desiredPage=currentPage;await releaseDocument();
 $('notice').hidden=false;$('message').textContent='正在读取课件…';$('retry').hidden=true;
 for(const id of ['page','previous','next','zoom'])$(id).disabled=true;
 try{
  if([courseId,activityId,quizId].some(id=>!/^\d{1,12}$/.test(id||'')))throw new Error('课件编号无效');
  const descriptor=await new RemoteLms().quizPreview(courseId,activityId,quizId);if(version!==revision)return;
  document.title=descriptor.title;
  const task=getDocument({url:descriptor.url,withCredentials:new URL(descriptor.url).hostname==='zy-eclass.bit.edu.cn',
   cMapUrl:chrome.runtime.getURL('pdfjs/cmaps/'),cMapPacked:true,standardFontDataUrl:chrome.runtime.getURL('pdfjs/standard_fonts/'),
   wasmUrl:chrome.runtime.getURL('pdfjs/wasm/'),isEvalSupported:false});
  loadingTask=task;const loaded=await task.promise;if(version!==revision){await task.destroy();return;}pdf=loaded;
  const first=await loaded.getPage(1),natural=first.getViewport({scale:1});if(version!==revision)return;
  firstWidth=natural.width;firstHeight=natural.height;
  const fragment=document.createDocumentFragment();
  for(let number=1;number<=loaded.numPages;number++){
   const element=document.createElement('div');element.className='document-page';element.setAttribute('aria-label',`第 ${number} 页`);
   element.style.aspectRatio=`${firstWidth} / ${firstHeight}`;element.style.width=pageWidth()+'px';
   pages.push({number,element,revision:0,loading:false});fragment.append(element);
  }
  viewport.append(fragment);currentPage=1;$('page-count').textContent='/ '+loaded.numPages;$('page').max=String(loaded.numPages);
  $('page').disabled=false;$('zoom').disabled=false;$('notice').hidden=true;updateNavigation();
  observer=new IntersectionObserver(entries=>{
   for(const change of entries){const entry=pages.find(page=>page.element===change.target);if(!entry)continue;
    if(change.isIntersecting){visible.add(entry);void renderPage(entry);}else{visible.delete(entry);releasePage(entry);}
   }
   updateCurrentPage();
  },{root:viewport,rootMargin:'300px 0px'});
  pages.forEach(entry=>observer.observe(entry.element));goToPage(desiredPage);
 }catch(error){
  if(version!==revision)return;await releaseDocument();
  $('message').textContent='课件暂时无法预览，请重新加载或在原站查看';$('retry').hidden=false;
 }
}
$('previous').onclick=()=>goToPage(currentPage-1);$('next').onclick=()=>goToPage(currentPage+1);
$('page').onchange=()=>goToPage($('page').value);$('zoom').onchange=()=>{resizePages();goToPage(currentPage);};
$('retry').onclick=()=>void load();$('reload').onclick=()=>void load();
viewport.addEventListener('scroll',()=>{
 cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(updateCurrentPage);
},{passive:true});
const resizeObserver=new ResizeObserver(()=>{
 if(!viewport.clientWidth||viewport.clientWidth===previousWidth)return;previousWidth=viewport.clientWidth;
 cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{resizePages();if(pdf&&document.activeElement!==$('page'))goToPage(currentPage);});
});resizeObserver.observe(viewport);
window.addEventListener('pagehide',()=>{revision++;resizeObserver.disconnect();cancelAnimationFrame(resizeFrame);cancelAnimationFrame(scrollFrame);void releaseDocument();},{once:true});
void load();
