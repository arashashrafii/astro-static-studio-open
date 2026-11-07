import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegacyContentV1Schema} from '@astro-static-studio/contracts';
import {importContent} from '../packages/contracts/src/content-migration.js';
import {projectsIndexView} from '../apps/site/src/lib/projects-route.js';

const legacy=LegacyContentV1Schema.parse({version:1,site:{name:'Route test',tagline:'',email:'',phone:''},entries:[
  {id:'a7b1bb0e-92b7-4772-b88e-60389c07c033',kind:'page',slug:'about',title:'About',summary:'',published:true,components:[]},
  {id:'9e9eeb74-5df7-4c51-9de7-d6e45b239074',kind:'project',slug:'sample',title:'Sample project',summary:'A saved project',published:true,components:[{type:'text',body:'Details'}]},
]});

test('legacy data imports into the canonical collection route before rendering',()=>{
  const view=projectsIndexView(importContent(legacy));
  assert.equal(view.collection?.slug,'projects');
  assert.equal(view.collection?.routeBase,'portfolio');
  assert.deepEqual(view.items.filter(item=>item.collectionId===view.collection?.id&&item.published).map(item=>item.slug),['sample']);
});
