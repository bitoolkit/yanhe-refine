import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('a permanently failing PDF page stops retrying until the user retries explicitly',async()=>{
 const source=await readFile(new URL('../src/courseware-viewer.js',import.meta.url),'utf8');
 const element=()=>({children:[],setAttribute(){},append(child){this.children.push(child);},remove(){}});
 const toolbar={value:'fit',clientWidth:600,clientHeight:500};
 const context=vm.createContext({document:{getElementById:()=>toolbar,createElement:element},location:{search:'?course=10&activity=30&quiz=40'},URL,URLSearchParams,console});
 vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf("$('previous').onclick")),context);
 vm.runInContext(`
  globalThis.attempts=0;
  pdf={getPage:async()=>{attempts++;throw new Error('permanent render failure');}};
  globalThis.entry={number:1,revision:0,loading:false,element:document.createElement('div')};
  visible.add(entry);
 `,context);
 await vm.runInContext('renderPage(entry)',context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.attempts,1);assert.equal(context.entry.failed,true);
 await vm.runInContext('renderPage(entry)',context);assert.equal(context.attempts,1);
 context.entry.element.children[0].onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.attempts,2);assert.equal(context.entry.failed,true);
});
