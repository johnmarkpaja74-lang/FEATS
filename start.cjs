'use strict';
const {spawn}=require('node:child_process');

async function start(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('FEATS needs Node.js 24 or newer. Install it, then run start.cmd again.');
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be a number between 1 and 65535.');
 const browserHost=host==='0.0.0.0'?'127.0.0.1':host==='::'?'[::1]':host.includes(':')&&!host.startsWith('[')?'['+host+']':host;
 const url=`http://${browserHost}:${port}`;
 const ready=()=>{
  console.log('FEATS shared server: '+url);
  if(process.argv.includes('--open')){
   const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
   const browser=spawn(command,[url],{detached:true,stdio:'ignore',windowsHide:true});
   browser.on('error',()=>console.log('Open '+url+' in your browser.'));browser.unref();
  }
 };
 const {createServer}=require('./server.cjs');
 const server=createServer();
 server.on('error',async error=>{
  server.close();
  if(error.code==='EADDRINUSE'){
   try{
    const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(3000)});
    const health=await response.json();
    if(response.ok&&health.ok===true&&health.staffSignup==='personal-code'&&health.studentQr===true){
     if(health.managementVersion!==1){console.error('An older FEATS server is running. Stop its terminal with Ctrl+C, then run start.cmd again to load the updates.');process.exitCode=1;return;}console.log('FEATS is already running. Using the existing server.');ready();return;
    }
   }catch{}
   console.error(`Port ${port} is used by another application. Stop that application or set PORT to another number before starting FEATS.`);
  }else console.error('Cannot start FEATS: '+error.message);
  process.exitCode=1;
 });
 server.listen(port,host,ready);
}
start().catch(error=>{console.error('Cannot start FEATS: '+error.message);process.exitCode=1;});
