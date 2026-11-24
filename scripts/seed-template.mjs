// Explicit, fictional initialization. Never called from application requests.
import { Client } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
export const COMPANY = 'a11e0000-0000-4000-8000-000000000001';
export const CYCLE = 'b11e0000-0000-4000-8000-000000000001';
export const TEAM = 'e11e0000-0000-4000-8000-000000000001';
export const ROOT_GOAL = 'c11e0000-0000-4000-8000-000000000001';
export const TEAM_GOAL = 'c11e0000-0000-4000-8000-000000000002';
export const PRIVATE_GOAL = 'c11e0000-0000-4000-8000-000000000003';
export const PRIVATE_KR = 'd11e0000-0000-4000-8000-000000000004';
const password = process.env.DEMO_PASSWORD;
if (!process.env.DATABASE_URL || !password || password.length < 12 || password.length > 128) throw new Error('DATABASE_URL and generated DEMO_PASSWORD (12–128 characters) are required');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('alineo_template_initialization'))");
  if ((await db.query('SELECT id FROM companies LIMIT 1')).rowCount) {
    await db.query('COMMIT');
    console.log('Existing workspace preserved; no account, password, goal or history changed.');
  } else {
    await db.query('INSERT INTO companies (id,name) VALUES ($1,$2)', [COMPANY,'Alineo Demo']);
    const staff = [
      ['alineo-demo-admin','Alex Morgan','admin@alineo.test','admin',true],
      ['alineo-demo-manager','Jordan Lee','manager@alineo.test','manager',true],
      ['alineo-demo-member','Casey Rivera','member@alineo.test','member',true],
      ['alineo-demo-inactive','Riley Brooks','inactive@alineo.test','member',false],
    ];
    for (const [id,name,email,role,active] of staff) {
      await db.query('INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)', [id,name,email]);
      await db.query("INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ($1,$2,'credential',$2,$3,now(),now())", [`${id}-credential`,id,await hashPassword(password)]);
      await db.query('INSERT INTO company_memberships (company_id,user_id,role,is_active,deactivated_at) VALUES ($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)', [COMPANY,id,role,active]);
    }
    await db.query("UPDATE company_memberships SET manager_id='alineo-demo-manager' WHERE user_id='alineo-demo-member' AND company_id=$1",[COMPANY]);
    await db.query("INSERT INTO teams (id,company_id,name,description,lead_user_id) VALUES ($1,$2,'Product','A fictional product team.','alineo-demo-manager')",[TEAM,COMPANY]);
    await db.query("INSERT INTO team_memberships (company_id,team_id,user_id,is_lead) VALUES ($1,$2,'alineo-demo-manager',true),($1,$2,'alineo-demo-member',false)",[COMPANY,TEAM]);
    const now = new Date(), year = now.getUTCFullYear(), quarter = Math.floor(now.getUTCMonth()/3);
    const start = new Date(Date.UTC(year,quarter*3,1)).toISOString().slice(0,10);
    const end = new Date(Date.UTC(year,quarter*3+3,0)).toISOString().slice(0,10), today = now.toISOString().slice(0,10);
    await db.query("INSERT INTO okr_cycles (id,company_id,name,start_date,end_date,status,created_by) VALUES ($1,$2,$3,$4,$5,'open','alineo-demo-admin')",[CYCLE,COMPANY,`Q${quarter+1} ${year}`,start,end]);
    const goals = [
      [ROOT_GOAL,'Improve customer onboarding','company','company','alineo-demo-admin',null,null,55],
      [TEAM_GOAL,'Ship a clearer setup flow','team','team','alineo-demo-member',TEAM,ROOT_GOAL,40],
      [PRIVATE_GOAL,'Prepare next-quarter roadmap','individual','restricted','alineo-demo-admin',null,null,25],
    ];
    for (const [id,title,level,visibility,owner,team,parent,progress] of goals) {
      await db.query("INSERT INTO objectives (id,company_id,cycle_id,title,description,level,visibility,owner_id,team_id,parent_objective_id,progress,due_date,created_by) VALUES ($1,$2,$3,$4,'Fictional example for exploring Alineo.',$5,$6,$7,$8,$9,$10,$11,'alineo-demo-admin')",[id,COMPANY,CYCLE,title,level,visibility,owner,team,parent,progress,end]);
      await db.query("INSERT INTO audit_logs (company_id,cycle_id,actor_id,action,entity_type,entity_id,reason) VALUES ($1,$2,'alineo-demo-admin','objective_created','objective',$3,'Created a fictional sample objective')",[COMPANY,CYCLE,id]);
    }
    const results = [
      ['d11e0000-0000-4000-8000-000000000001',ROOT_GOAL,'Complete 100 onboarding conversations','numeric','increasing',0,100,60,60,'alineo-demo-admin'],
      ['d11e0000-0000-4000-8000-000000000002',ROOT_GOAL,'Reach 100% setup completion','percentage','increasing',0,100,50,50,'alineo-demo-admin'],
      ['d11e0000-0000-4000-8000-000000000003',TEAM_GOAL,'Unlock 10,000 in expansion value','currency','increasing',0,10000,4000,40,'alineo-demo-member'],
      [PRIVATE_KR,PRIVATE_GOAL,'Approve the roadmap brief','binary','increasing',0,1,0,0,'alineo-demo-admin'],
      ['d11e0000-0000-4000-8000-000000000005',PRIVATE_GOAL,'Reduce unresolved research questions','numeric','decreasing',100,20,60,50,'alineo-demo-admin'],
    ];
    for (const [id,goal,title,type,direction,baseline,target,current,progress,owner] of results) {
      await db.query("INSERT INTO key_results (id,company_id,objective_id,title,metric_type,direction,baseline,target,current,progress,owner_id,due_date,last_effective_date,last_check_in_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())",[id,COMPANY,goal,title,type,direction,baseline,target,current,progress,owner,end,today]);
      await db.query("INSERT INTO kr_check_ins (company_id,cycle_id,objective_id,key_result_id,author_id,effective_date,value,progress,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Fictional initial check-in for this sample key result.')",[COMPANY,CYCLE,goal,id,owner,today,current,progress]);
    }
    await db.query("INSERT INTO objective_access (company_id,objective_id,user_id,permission) VALUES ($1,$2,'alineo-demo-member','viewer'),($1,$2,'alineo-demo-manager','editor')",[COMPANY,PRIVATE_GOAL]);
    await db.query("INSERT INTO key_result_editors (company_id,key_result_id,user_id) VALUES ($1,$2,'alineo-demo-member')",[COMPANY,PRIVATE_KR]);
    await db.query("INSERT INTO goal_comments (company_id,objective_id,author_id,body) VALUES ($1,$2,'alineo-demo-manager','Sample team note: review the onboarding findings at our next check-in.')",[COMPANY,ROOT_GOAL]);
    await db.query("INSERT INTO notifications (company_id,recipient_id,actor_id,type,title,body,link_path,entity_type,entity_id,dedup_key,email_status) VALUES ($1,'alineo-demo-member','alineo-demo-admin','assignment','Your sample goal is ready','Explore this fictional goal and add a check-in.','/dashboard/goals','objective',$2,'alineo-demo-assignment','in_app_only')",[COMPANY,TEAM_GOAL]);
    // Fictional, unaccepted invitation; the bearer token is generated per deployment.
    await db.query("INSERT INTO invitations (company_id,email,name,role,team_id,token,status,invited_by,expires_at,email_delivery_status) VALUES ($1,'teammate@alineo.test','Future Teammate','member',$2,$3,'pending','alineo-demo-admin',now()+interval '7 days','in_app_only')",[COMPANY,TEAM,randomBytes(32).toString('hex')]);
    await db.query('COMMIT');
    console.log('Seeded Alineo Demo: three roles, one inactive fixture, one team/cycle, three goals and five key results. Use the deployment-generated DEMO_PASSWORD; no email was sent.');
  }
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { await db.end(); }
