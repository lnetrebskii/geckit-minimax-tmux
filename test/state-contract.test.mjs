import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backgroundTasks, taskView, stopTask, usesKey, selectedModel, quotaUsage } from '../src/mcode-state.mjs';
import { instructionGuide } from '../src/mcode-guide.mjs';
import { messageItemsWithImages } from '../src/mcode-history.mjs';
import { terminalScreen } from '../src/mcode-terminal.mjs';
import { create } from '../src/mcode-provider.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('background tasks preserve lifecycle, native output paths and stop errors', async () => {
  const summary = { task_id: 'task / 1', owner_session_id: 'mvs_one', display_name: 'test', status: 1, created_at: 10 };
  const calls = [];
  let fail = false;
  const rpc = { request: async (path, method) => {
    calls.push({path, method});
    if (path.endsWith('/stop')) return fail ? { operation_error: { message: 'Still running' } } : { task: {...summary, status: 5} };
    if (path.endsWith('/background-tasks')) return { items: [summary, {...summary, is_deleted: true}] };
    return { task: {...summary, command: 'sleep 10', output_file_path: 'file:///tmp/task%20log', exit_code: 0} };
  }};
  const tasks = await backgroundTasks(rpc, 'mvs_one');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].output, '/tmp/task log');
  assert.equal(tasks[0].status, 'running');
  assert.equal(tasks[0].command, 'sleep 10');
  assert.match(calls[1].path, /task%20%2F%201$/);
  assert.equal((await stopTask(rpc, 'mvs_one', summary.task_id)).task.status, 5);
  assert.equal(calls.at(-1).method, 'POST');
  fail = true; await assert.rejects(stopTask(rpc, 'mvs_one', summary.task_id), /Still running/);
  for (const [native, status] of [[0,'running'],[2,'running'],[3,'completed'],[4,'failed'],[5,'stopped'],[6,'failed']]) assert.equal(taskView({...summary, status:native}).status,status);
  assert.equal(taskView({...summary, output_file_path:'relative'}).output, undefined);
  assert.equal(taskView({...summary, created_at:'bad'}), undefined);
  await assert.rejects(backgroundTasks({request: async () => {throw new Error('Offline');}},'one'), /Offline/);
});

test('billing source and model selection are explicit and scoped to the session', async () => {
  let source = 'token_plan', path;
  const rpc = {request: async p => {path=p; return p.includes('/models/list') ? { models:[{provider_id:'minimax',model_id:'m',selected:true}] } : {active_source:source};}};
  assert.equal((await selectedModel(rpc,'one')).model_id,'m');
  assert.match(path,/session_id=one$/);
  assert.equal(await usesKey(rpc,{provider_id:'minimax'}),false);
  source='minimax_api_key'; assert.equal(await usesKey(rpc,{provider_id:'minimax'}),true);
  source='unknown'; assert.equal(await usesKey(rpc,{provider_id:'minimax'}),undefined);
  assert.equal(await usesKey({request(){assert.fail('No MiniMax lookup for BYOK');}},{provider_id:'custom'}),true);
  assert.deepEqual(quotaUsage({fiveHour:{part:0.5,resetsAt:100}},42),{quotas:[{id:'fiveHour',name:'5h',part:0.5,resetsAt:100}],measuredAt:42});
});

test('BYOK account works without MiniMax OAuth and does not display subscription quota', async () => {
  const provider = create({}, {
    program: async () => ({version:'0.7.4'}),
    rpc: {account:async()=>({state:'unauthenticated'}),request:async()=>({models:[{provider_id:'custom',model_id:'model',selected:true,enabled:true,context_limit:1000}]}),dispose(){}},
    quota: {windows(){assert.fail('No subscription quota for BYOK');},dispose(){}},
  });
  try {
    const account = await provider.account();
    assert.equal(account.key,true); assert.equal(account.signedIn,true); assert.equal(account.plan,undefined); assert.equal(account.usage,undefined);
    assert.equal((await provider.limits(['custom/model'])).plan,undefined);
  } finally {provider.dispose();}
});

test('limits loads model capacity without depending on an earlier models call', async()=>{
  let calls=0;
  const provider=create({}, {rpc:{request:async()=>{calls++;return {models:[{provider_id:'minimax',model_id:'model',context_limit:5000}]};},dispose(){}},quota:{windows:async()=>undefined,dispose(){}}});
  try {assert.equal((await provider.limits(['model'])).windows.get('model'),5000);assert.equal(calls,2);}finally{provider.dispose();}
});

test('instructions are opt-in, source-specific, and disable without rewriting user files', async () => {
  let reads=0;
  const guide=instructionGuide({home:'/home/test',source:'/apps/my geckit',sourceGuide:'/source/GECKIT.md',read:async path=>{reads++;assert.equal(path,'/source/GECKIT.md');return 'Guide';}});
  assert.equal(await guide.prompt(),''); assert.equal(reads,0);
  guide.set(true); assert.match(await guide.prompt(),/^Guide[\s\S]*"\/apps\/my geckit"/);
  guide.set(false); assert.equal(await guide.prompt(),''); assert.equal(reads,1);
});

test('source-app fallback never reads installed-app guide when source guide is unavailable',async()=>{
  const guide=instructionGuide({source:'/source/geckit-local',sourceGuide:'',read:()=>assert.fail('Wrong app guide')});
  guide.set(true); assert.match(await guide.prompt(),/This conversation runs in GeckIt[\s\S]*\/source\/geckit-local/);
});

test('restores image-only messages, bounds file reads and rejects arbitrary non-image bytes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mcode-image-contract-'));
  try {
    const file=join(dir,'picture.png'), bad=join(dir,'not-an-image.png');
    await writeFile(file,Buffer.from(png,'base64')); await writeFile(bad,'private text');
    const items=await messageItemsWithImages({msg_id:'user',role:'user',attachments:[
      {meta:{mime_type:'image/png'},local:{file_path:file}},
      {local:{data_url:`data:image/png;base64,${png}`}},
      {meta:{mime_type:'image/png'},local:{file_path:bad}},
      {local:{data_url:'https://example.com/untrusted.png'}},
    ]});
    assert.equal(items[0].kind,'mine'); assert.equal(items[0].text,''); assert.equal(items[0].images.length,2);
    assert.deepEqual(items[0].images[0],{media:'image/png',data:png});
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('tool paths and writes require completed native write/edit operations; failed writes never claim success', async () => {
  const tools=[
    {tool_name:'write',tool_call_id:'ok',tool_call_status:2,tool_call_args:'{"path":"a.txt"}'},
    {tool_name:'edit',tool_call_id:'failed',tool_call_status:3,tool_call_args:'{"file_path":"/repo/b.txt"}'},
    {tool_name:'read',tool_call_id:'image',tool_call_status:2,tool_call_result_data:JSON.stringify({content:[{type:'image',mimeType:'image/png',data:png}]})},
  ];
  const items=await messageItemsWithImages({msg_id:'a',role:'assistant',tool_calls:tools},'/repo');
  assert.deepEqual(items.filter(x=>x.kind==='wrote'),[{kind:'wrote',id:'a:tool:ok:wrote',paths:['/repo/a.txt']}]);
  assert.equal(items.find(x=>x.id==='a:tool:image').images[0].data,png);
  assert.equal(items.find(x=>x.id==='a:tool:failed').path,'/repo/b.txt');
});

test('mode evidence comes from the current editor footer, not quoted transcript text',()=>{
  const editor='Message · Enter send\n──────────\n› Send\n──────────\nroot │ Ask │ Context 512K';
  assert.equal(terminalScreen('root │ Auto │ Context 512K\n'+editor).mode,'manual');
  assert.equal(terminalScreen('root │ Auto │ Context 512K').mode,undefined);
});
