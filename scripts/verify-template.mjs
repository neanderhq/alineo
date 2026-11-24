// Real production-image, role, persistence and recovery verification.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, request } from 'playwright';
import pg from 'pg';
import { verifyRecovery } from './verify-recovery.mjs';
const exec=promisify(execFile);
const COMPANY='a11e0000-0000-4000-8000-000000000001', ROOT='c11e0000-0000-4000-8000-000000000001', PRIVATE='c11e0000-0000-4000-8000-000000000003', KR='d11e0000-0000-4000-8000-000000000004';
async function run(command,args,options={}) {
  const {allowFailure=false,...rest}=options;
  try {const r=await exec(command,args,{timeout:300000,maxBuffer:16*1024*1024,...rest});process.stdout.write(r.stdout);process.stderr.write(r.stderr);return {code:0};}
  catch(e){process.stdout.write(e.stdout||'');process.stderr.write(e.stderr||'');if(allowFailure)return {code:e.code||1};throw e;}
}
async function json(r,status=200){assert.equal(r.status(),status,await r.text());return r.json();}
async function main(){
  const image=process.env.NEANDER_TEMPLATE_IMAGE,url=process.env.NEANDER_TEMPLATE_TEST_DATABASE_URL,password=process.env.DEMO_PASSWORD,secret=process.env.BETTER_AUTH_SECRET;
  assert.ok(image&&url&&password&&secret,'Supply the built image, explicitly disposable database and generated test credentials');assert.equal(process.env.DATABASE_URL,url);
  const origin=new URL(process.env.BETTER_AUTH_URL);assert.ok(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname));assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
  const root=resolve('.'),directory=await mkdtemp(join(tmpdir(),'alineo-check-')),containers=[];
  const db=new pg.Client({connectionString:url});await db.connect();let browser,recoveryDatabase;
  async function ready(address){for(let i=0;i<120;i++){try{if((await fetch(address+'/api/health')).ok)return;}catch{}await delay(500);}throw Error('Alineo image did not become ready');}
  async function start(connection,address,name='alineo-check-'+randomUUID().slice(0,12)){
    const runtimeUrl=new URL(connection);if(process.platform==='darwin')runtimeUrl.hostname='host.docker.internal';
    const bundle=join(directory,name+'.env');await writeFile(bundle,`DATABASE_URL=${runtimeUrl.href}\nBETTER_AUTH_URL=${address}\nBETTER_AUTH_SECRET=${secret}\n`,{mode:0o644});
    const port=new URL(address).port||80,network=process.platform==='linux'?['--network','host','--env',`PORT=${port}`]:['--publish',`127.0.0.1:${port}:8080`];
    await exec('docker',['run','--detach','--name',name,'--mount',`type=bind,src=${bundle},dst=/run/secrets/neander_environment,readonly`,...network,image],{timeout:60000});containers.push(name);await ready(address);return name;
  }
  const contexts=[];
  async function apiClient(address=origin.origin){const c=await request.newContext({baseURL:address,extraHTTPHeaders:{origin:address,'x-forwarded-for':`2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`}});contexts.push(c);return c;}
  async function login(role){const c=await apiClient();await json(await c.post('/api/auth/sign-in/email',{data:{email:role+'@alineo.test',password}}));return c;}
  try{
    const name=await start(url,origin.origin);
    const before=(await db.query('SELECT id,title,version FROM objectives ORDER BY id')).rows, hashes=(await db.query('SELECT id,password FROM account ORDER BY id')).rows;
    assert.equal(before.length,3);assert.equal((await db.query('SELECT count(*)::int AS n FROM key_results')).rows[0].n,5);
    await run('pnpm',['db:seed']);assert.deepEqual((await db.query('SELECT id,title,version FROM objectives ORDER BY id')).rows,before);assert.deepEqual((await db.query('SELECT id,password FROM account ORDER BY id')).rows,hashes);
    const roles=new Map();for(const role of ['admin','manager','member','inactive']){const c=await login(role);roles.set(role,c);assert.equal((await c.get('/api/workspace')).status(),role==='inactive'?403:200);assert.equal((await c.get('/api/exports/backup')).status(),role==='admin'?200:403);}
    const admin=roles.get('admin'),member=roles.get('member'),anonymous=await apiClient();assert.equal((await anonymous.get('/api/workspace')).status(),401);
    const m=await json(await member.get('/api/workspace')),restricted=m.cycles.flatMap(c=>c.objectives).find(o=>o.id===PRIVATE);assert.ok(restricted&&!restricted.canEdit);assert.ok(restricted.keyResults.find(k=>k.id===KR).canCheckIn);
    assert.equal((await admin.post('/api/teams',{headers:{origin:'https://other.apps.neander.ai','content-type':'text/plain'},data:JSON.stringify({name:'Blocked cross-site team'})})).status(),403);
    assert.equal((await admin.post('/api/teams',{headers:{origin:''},data:{name:'Missing origin team'}})).status(),403);
    assert.equal((await anonymous.post('/api/recovery-link',{data:{email:'admin@alineo.test'}})).status(),503,'Production recovery must fail explicitly until operator configures delivery');
    assert.equal((await anonymous.post('/api/auth/sign-in/email',{data:{email:'admin@alineo.test',password:'Demo1234!'}})).status(),401,'Old fixed password must not work');
    const stranger=await apiClient(),outsiderPassword=randomBytes(24).toString('base64url');
    await json(await stranger.post('/api/auth/sign-up/email',{data:{name:'Independent Template User',email:`independent-${randomUUID()}@alineo.test`,password:outsiderPassword}}));
    const own=await json(await stranger.get('/api/workspace'));assert.notEqual(own.company.id,COMPANY);assert.equal(own.company.role,'admin');assert.ok(!own.cycles.flatMap(c=>c.objectives).some(o=>o.id===ROOT));
    assert.equal((await stranger.patch('/api/objectives/'+ROOT,{data:{title:'Unauthorized edit',version:1}})).status(),404);
    await run('pnpm',['exec','playwright','install',...(process.platform==='linux'?['--with-deps']:[]),'chromium']);browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
    await page.goto(origin.origin);assert.match(await page.title(),/Alineo/i);
    await page.getByRole('button',{name:'Sign in',exact:true}).first().click();await page.getByLabel('Email Address',{exact:true}).fill('admin@alineo.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await page.getByText('Alineo Demo · Alineo workspace',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
    const capture=process.env.ALINEO_CAPTURE_DIRECTORY;if(capture){await mkdir(join(capture,'screenshots'),{recursive:true});await page.screenshot({animations:'disabled',path:join(capture,'thumbnail.png')});if(process.env.ALINEO_CAPTURE_HERO)await page.screenshot({animations:'disabled',path:join(root,'public/okrhome.png')});}
    for(const [path,heading,file] of [['goals','Goals','goals'],['team','User Management','people'],['activity','Activity','activity']]){await page.goto(origin.origin+'/dashboard/'+path);await page.getByRole('heading',{name:heading,exact:true}).waitFor();if(path==='team')await page.getByRole('row').filter({hasText:'admin@alineo.test'}).waitFor();if(path==='goals'){await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('tab',{name:/^all goals$/i}).click();await page.getByText('Ship a clearer setup flow',{exact:true}).first().waitFor();}if(capture)await page.screenshot({animations:'disabled',path:join(capture,'screenshots',file+'.png')});}
    await page.setViewportSize({width:390,height:844});await page.goto(origin.origin+'/dashboard');await page.getByRole('heading',{name:'Home',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile dashboard has no horizontal page overflow');
    await context.close();await browser.close();browser=undefined;
    const workspace=await json(await admin.get('/api/workspace')),goal=workspace.cycles.flatMap(c=>c.objectives).find(o=>o.id===ROOT),edited='Template edit '+randomUUID().slice(0,8);
    await json(await admin.patch('/api/objectives/'+ROOT,{data:{title:edited,version:goal.version}}));await run('pnpm',['db:seed']);await exec('docker',['restart',name],{timeout:60000});await ready(origin.origin);assert.equal((await json(await admin.get('/api/workspace'))).cycles.flatMap(c=>c.objectives).find(o=>o.id===ROOT).title,edited);
    await run(process.execPath,['--experimental-strip-types','--experimental-transform-types','--import','./scripts/register-loader.mjs','scripts/archive-restore.check.mts']);
    for(const script of ['test-goal-restore-live.mjs','test-req2-live.mjs','test-req3-status.mjs'])await run(process.execPath,['scripts/'+script,origin.origin]);
    const backup=await json(await admin.get('/api/exports/backup'));assert.equal(backup.company.id,COMPANY);
    recoveryDatabase='alineo_recovery_'+randomUUID().replaceAll('-','');await db.query(`CREATE DATABASE "${recoveryDatabase}"`);const recoveryUrl=new URL(url);recoveryUrl.pathname='/'+recoveryDatabase;const recoveryOrigin=new URL(origin);recoveryOrigin.port=String(Number(origin.port||80)+1);
    await verifyRecovery({backup,directory,sourceRoot:root,databaseUrl:recoveryUrl.href,origin:recoveryOrigin.origin,request,start,run});
    console.log('PASS: clean Alineo production image; generated credentials and seed preservation; workspace isolation, roles and Origin checks; real desktop/mobile browser; persistent edit; archive, notification and full recovery regressions.');
  }finally{
    await browser?.close();for(const c of contexts)await c.dispose();for(const name of containers)await exec('docker',['rm','--force',name],{timeout:30000}).catch(()=>{});if(recoveryDatabase)await db.query(`DROP DATABASE "${recoveryDatabase}" WITH (FORCE)`);await db.end();await rm(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
