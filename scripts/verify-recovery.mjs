// Run only from the built-image test harness, with a synthetic backup and own DB.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
pg.types.setTypeParser(1082, value => value);
const collections = { users:'user',companyMemberships:'company_memberships',teamMemberships:'team_memberships',teams:'teams',cycles:'okr_cycles',objectives:'objectives',keyResults:'key_results',checkIns:'kr_check_ins',comments:'goal_comments',auditLogs:'audit_logs',objectiveAccess:'objective_access',keyResultEditors:'key_result_editors',invitations:'invitations',notifications:'notifications' };
const tables = ['companies','user','account','session','verification','company_memberships','team_memberships','teams','okr_cycles','objectives','key_results','kr_check_ins','goal_comments','audit_logs','objective_access','key_result_editors','invitations','notifications'];
export async function verifyRecovery({ backup, directory, sourceRoot, databaseUrl, origin, request, start, run }) {
  const db = new pg.Client({ connectionString:databaseUrl }); await db.connect();
  const fixture = join(directory,'fictional-backup.json'), cwd = join(directory,'restore-work'); await mkdir(cwd);
  await writeFile(fixture,JSON.stringify(backup),{mode:0o600});
  const manifest = join(cwd,'docs/recovery/recovery-credentials.json');
  const env = { PATH:process.env.PATH, HOME:process.env.HOME, DATABASE_URL:databaseUrl };
  let assertions=0;
  const check = (value,label) => { assert.ok(value,label); assertions++; };
  async function restore(path=fixture,allowFailure=false) { return run(process.execPath,[join(sourceRoot,'scripts/restore-backup.mjs'),path],{cwd,env,allowFailure}); }
  async function client() { return request.newContext({baseURL:origin,extraHTTPHeaders:{origin,'x-forwarded-for':`2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`}}); }
  async function signIn(email,password) { const c=await client();const r=await c.post('/api/auth/sign-in/email',{data:{email,password}});check(r.status()===200,'Recovery password authenticates');return c; }
  async function compareDomain() {
    for(const [key,table] of Object.entries(collections)) {
      const actual=(await db.query(`SELECT * FROM "${table}"`)).rows, expected=backup[key]||[];
      const byId=new Map(actual.filter(x=> key==='users' ? expected.some(e=>e.id===x.id):x.company_id===backup.company.id).map(x=>[x.id,x]));
      check(byId.size===expected.length,`Restored ${key} record IDs`);
      for(const row of expected) {
        const saved=byId.get(row.id);assert.ok(saved,`${key} ID retained`);
        for(const [field,value] of Object.entries(row)) {
          const column=field.replace(/[A-Z]/g,l=>'_'+l.toLowerCase());
          if(!(column in saved))continue;
          let a=saved[column],b=value;
          if(a instanceof Date)a=a.toISOString();
          if(['progress','baseline','target','current','value'].includes(field)&&a!==null&&b!==null){a=Number(a);b=Number(b);}
          assert.deepEqual(a,b,`${key}.${field} preserved`);
        }
      }
    }
  }
  try {
    await run(process.execPath,[join(sourceRoot,'.neander/migrate.mjs')],{cwd:sourceRoot,env});
    await restore(); let creds=JSON.parse(await readFile(manifest,'utf8')).credentials;
    check((await stat(manifest)).mode%0o1000===0o600,'Credential manifest is0600');
    check(new Set(creds.map(x=>x.temporaryPassword)).size===creds.length,'Unique generated temporary passwords');
    check(['objectiveAccess','keyResultEditors','invitations','notifications'].every(k=>backup[k].length>0),'Nonempty ACL/editor/invite/notification fixtures');
    await compareDomain();
    await start(databaseUrl,origin);
    const sessions=new Map(), roleUsers=new Map();
    for(const role of ['admin','manager','member','inactive']) {
      const membership=backup.companyMemberships.find(x=>role==='inactive'?!x.isActive:x.isActive&&x.role===role);
      const user=creds.find(x=>x.userId===membership.userId);roleUsers.set(role,user);
      const c=await signIn(user.email,user.temporaryPassword);sessions.set(role,c);
      check((await c.get('/api/workspace')).status()===(role==='inactive'?403:200),'Restored role authorization');
      check((await c.get('/api/exports/backup')).status()===(role==='admin'?200:403),'Restored export authorization');
    }
    const member=roleUsers.get('member'), memberClient=sessions.get('member'), changedPassword=randomBytes(24).toString('base64url')+'Aa1!';
    check((await memberClient.post('/api/auth/reset-password',{data:{token:member.resetToken,newPassword:changedPassword}})).status()===200,'Manifest reset token consumed by actual auth API');
    check((await memberClient.get('/api/workspace')).status()===401,'Reset revokes active member session');
    check((await memberClient.post('/api/auth/reset-password',{data:{token:member.resetToken,newPassword:changedPassword}})).status()===400,'Manifest token single use');
    const freshMember=await signIn(member.email,changedPassword);
    check((await freshMember.post('/api/auth/request-password-reset',{data:{email:member.email,redirectTo:origin+'/reset-password'}})).status()===200,'Normal auth reset request');
    const reset=(await db.query("SELECT identifier FROM verification WHERE value=$1 AND identifier LIKE 'reset-password:%' ORDER BY expires_at DESC",[member.userId])).rows[0];assert.ok(reset);
    const normalToken=reset.identifier.slice('reset-password:'.length), normalPassword=randomBytes(24).toString('base64url')+'Aa1!';
    check((await freshMember.post('/api/auth/reset-password',{data:{token:normalToken,newPassword:normalPassword}})).status()===200,'Normal auth token updates password');
    check((await freshMember.get('/api/workspace')).status()===401,'Normal reset revokes sessions');
    check((await freshMember.post('/api/auth/reset-password',{data:{token:normalToken,newPassword:normalPassword}})).status()===400,'Normal token single use');
    const additional=new Map();
    for(const [role,user] of roleUsers) additional.set(role,await signIn(user.email,role==='member'?normalPassword:user.temporaryPassword));
    const other=await client(), otherPassword=randomBytes(24).toString('base64url');
    const signup=await other.post('/api/auth/sign-up/email',{data:{name:'Unrelated Recovery Control',email:`unrelated-${randomUUID()}@alineo.test`,password:otherPassword}});check(signup.status()===200,'Independent unrelated account control');
    const otherId=(await signup.json()).user.id;
    await chmod(manifest,0o644);await restore();creds=JSON.parse(await readFile(manifest,'utf8')).credentials;
    check((await stat(manifest)).mode%0o1000===0o600,'Repeat restore corrects existing manifest permissions');
    for(const c of [...sessions.values(),...additional.values()])check((await c.get('/api/workspace')).status()===401,'Repeat restore revokes all affected active sessions');
    check((await other.get('/api/auth/get-session')).status()===200&&(await (await other.get('/api/auth/get-session')).json()).user.id===otherId,'Unrelated session preserved');
    const admin=roleUsers.get('admin'), newAdmin=creds.find(x=>x.userId===admin.userId),control=await signIn(admin.email,newAdmin.temporaryPassword);
    const wrong=await client();check((await wrong.post('/api/auth/sign-in/email',{data:{email:admin.email,password:admin.temporaryPassword}})).status()===401,'Prior restore password rejected');
    for(const user of creds) {
      const c=await signIn(user.email,user.temporaryPassword);await c.dispose();
    }
    async function snapshot(){const out={};for(const table of tables)out[table]=(await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;return out;}
    const before=await snapshot(),manifestBefore=await readFile(manifest),invalid=structuredClone(backup);
    invalid.auditLogs.push({...invalid.auditLogs[0],id:randomUUID(),cycleId:randomUUID()});
    const broken=join(directory,'invalid-late-backup.json');await writeFile(broken,JSON.stringify(invalid),{mode:0o600});
    const failed=await restore(broken,true);check(failed.code!==0,'Late SQL failure rejects recovery');
    assert.deepEqual(await snapshot(),before,'Late failure rolls back all eighteen tables including sessions/passwords');assertions++;
    assert.deepEqual(await readFile(manifest),manifestBefore,'Late failure preserves previous credential manifest');assertions++;
    check((await control.get('/api/workspace')).status()===200,'Rolled-back restore retains authenticated session');
    const stillWorks=await signIn(admin.email,newAdmin.temporaryPassword);await stillWorks.dispose();
    // Compare only the restored company; the independent control account remains outside it.
    await compareDomain();
    for(const c of [...sessions.values(),...additional.values(),other,control,freshMember,wrong])await c.dispose();
    console.log(`PASS: ${assertions} synthetic recovery assertions plus field/ID comparisons; real auth tokens, all-role session revocation, unrelated-session preservation, eighteen-table SQL rollback and0600 credentials.`);
  } finally {await db.end();}
}
