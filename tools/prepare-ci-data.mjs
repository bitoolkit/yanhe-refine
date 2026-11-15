// Synthetic public catalogs for a clean CI checkout. Existing local catalogs take precedence.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {currentTeachingTerm} from '../src/teaching-terms.js';

const folder=resolve('local-data'),date=new Date().toISOString(),term=currentTeachingTerm();
await mkdir(folder,{recursive:true});await mkdir('test-results',{recursive:true});
async function create(name,value){
 try{await writeFile(resolve(folder,name),JSON.stringify(value),{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;}
}
await create('release-catalog.json',{
 schema:1,snapshot_date:date,counts:{total:1,modern:1,legacy:0},
 courses:[{platform:'modern',id:'100',tenant:'21',title:'合成目录课程',teacher:'合成教师',term,college:'',code:''}]
});
await create('release-session-index.json',{
 format:'yanhekt-session-index/v1',generatedAt:date,partial:false,source:{kind:'self-collected'},coverage:{courses:1,sessions:1},
 courses:[{id:'200',name:'合成旧站课程',number:'',teachers:['合成教师'],term,sessions:['300']}]
});
