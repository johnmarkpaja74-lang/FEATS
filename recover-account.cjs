'use strict';
// Recovery is available only to someone with filesystem access to the server.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const management=require('./management.cjs');
function recover(){
 const identifier=process.argv[2];
 if(!identifier||identifier==='--help'){console.log('Usage: node recover-account.cjs "account email or ID"\nRun on the server computer. Give the one-time code privately to the verified account owner.');return;}
 const dataDir=path.resolve(process.env.FEATS_DATA_DIR||path.join(__dirname,'data')),file=path.join(dataDir,'feats.sqlite');
 if(!fs.existsSync(file))throw Error('Start FEATS and create your administrator account first.');
 const database=new DatabaseSync(file);
 try{
  database.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const state=JSON.parse(database.prepare('SELECT json FROM workspace WHERE id=1').get().json);management.migrate(state);
  const account=state.users.find(user=>user.email===identifier.trim().toLowerCase()||user.schoolId===identifier.replace(/\s+/g,'')||user.staffCode===identifier.trim().toUpperCase());
  if(!account||account.status!=='active')throw Error('An active account with that identifier was not found.');
  const code=crypto.randomBytes(24).toString('base64url'),expiresAt=Date.now()+15*60*1000;
  state.recoveryRequests.filter(request=>request.userId===account.id).forEach(request=>{request.status='superseded';delete request.resetHash;});
  state.recoveryRequests.push({id:'recovery-'+crypto.randomUUID(),userId:account.id,status:'issued',resetHash:management.hash(code),expiresAt,createdAt:new Date().toISOString(),issuedBy:'server-owner',verificationNote:'Local server owner initiated recovery'});
  management.audit(state,{id:'server-owner',name:'Server owner'},'issueLocalReset',account.id,'Local terminal recovery; one-time code expires in 15 minutes');
  state.revision++;database.prepare('UPDATE workspace SET json=? WHERE id=1').run(JSON.stringify(state));database.exec('COMMIT');
  console.log('One-time code for '+account.email+': '+code+'\nExpires: '+new Date(expiresAt).toISOString()+'\nOpen Forgot password? and enter the code.');
 }catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
 finally{database.close();}
}
try{recover();}catch(error){console.error('Recovery failed: '+error.message);process.exitCode=1;}
