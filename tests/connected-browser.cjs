'use strict';
const {createServer}=require('../server.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'feats-connected-'));
(async()=>{
 const server=createServer({dataDir:path.join(temp,'data')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+path.join(temp,'chrome'),'about:blank'],{windowsHide:true,stdio:'ignore'});let ws;
 try{
  let version;for(let i=0;i<30;i++){try{const port=fs.readFileSync(path.join(temp,'chrome','DevToolsActivePort'),'utf8').split('\n')[0];version=await(await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).json();break;}catch{await pause(200);}}if(!version)throw Error('Chrome did not start');
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let serial=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  async function page(){const {browserContextId}=await send('Target.createBrowserContext');const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Runtime.enable',{},sessionId);await send('Page.navigate',{url},sessionId);
   async function run(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
   for(let i=0;i<100;i++){if(await run("typeof startApp==='function'"))break;await pause(100);}await pause(100);
   return {run,sessionId};
  }
  async function until(p,expression){for(let i=0;i<80;i++){if(await p.run(expression))return;await pause(100);}throw Error('Condition timed out: '+expression+' / '+await p.run("$('authError').textContent+' / '+$('toast').textContent"));}
  const student=await page(),officer=await page(),admin=await page(),second=await page();
  await student.run("openAuth('signup');$('authConfirm').value='short';$('togglePassword').click();setAuthMode('login')");
  assert.equal(await student.run("$('authConfirm').disabled&&$('authPassword').type==='password'&&$('togglePassword').getAttribute('aria-pressed')==='false'&&$('togglePassword').getAttribute('aria-label')==='Show password'"),true,'Login disables hidden signup fields and resets password visibility');
  const setupCode=JSON.parse(fs.readFileSync(path.join(temp,'data','admin-setup.json'),'utf8')).code;
  async function signup(p,role,email,name,schoolId){
   await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},p.sessionId);
   await p.run(`openAuth('signup','${role}')`);
   const fits=await p.run('document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight');
   if(!fits){const capture=await send('Page.captureScreenshot',{format:'png'},p.sessionId);fs.writeFileSync(path.join(__dirname,'connected-signup.png'),Buffer.from(capture.data,'base64'));console.log(await p.run("JSON.stringify({height:innerHeight,scroll:document.documentElement.scrollHeight,fields:[...document.querySelectorAll('#authForm>*')].filter(e=>!e.hidden).map(e=>({id:e.id,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top}))})"));}
   assert.equal(fits,true,role+' desktop signup fits viewport');
   await p.run(`$('authName').value='${name}';$('authEmail').value='${email}';$('authPassword').value='Password123';$('authConfirm').value='Password123';$('authSchoolId').value='${schoolId||''}';$('authCourse').value='${role==='student'?'BSIT':''}';$('authStaffCode').value='my-${role}-01';$('authSetupCode').value=${JSON.stringify(setupCode)};$('authForm').requestSubmit()`);if(role==='officer'){await until(p,"$('authError').textContent.includes('Account submitted')");await admin.run("(async()=>{await syncWorkspace();const account=db.users.find(u=>u.role==='officer');await saveAction('accountStatus',{id:account.id,status:'active'});})()");await p.run("openAuth('login','officer');$('authEmail').value='my-officer-01';$('authPassword').value='Password123';$('authForm').requestSubmit()");}await until(p,`currentUser?.role==='${role}'`);
  }
  await signup(student,'student','student@example.test','Student One','2021-3090');await signup(second,'student','second@example.test','Student Two','2022-4090');await signup(admin,'admin','admin@example.test','Adviser');await signup(officer,'officer','officer@example.test','Collector');
  assert.equal(await officer.run('currentUser.staffCode'),'MY-OFFICER-01');
  assert.equal(await admin.run('currentUser.staffCode'),'MY-ADMIN-01');
  assert.equal(await student.run('currentUser.course'),'BSIT');
  const studentId=await student.run('currentUser.id');
  await student.run("navigate('profile');$('profileCourseForm').elements.section.value='Unsaved section';$('profileCourseForm').elements.year.value='3rd Year'");
  await student.run("db.revision=-1;syncWorkspace()");
  assert.equal(await student.run("$('profileCourseForm').elements.section.value==='Unsaved section'&&$('profileCourseForm').elements.year.value==='3rd Year'"),true,'Polling preserves unsaved student details');

  await student.run("navigate('profile')");await until(student,"document.querySelector('#studentProfileQr canvas')!==null");
  const personalQr=await student.run("'FEATS-STUDENT:'+currentUser.attendanceToken");
  assert.notEqual(personalQr,await second.run("'FEATS-STUDENT:'+currentUser.attendanceToken"));
  const qrPng=await student.run("(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=280;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,280,280);context.drawImage(document.querySelector('#studentProfileQr canvas'),30,30);return canvas.toDataURL('image/png').split(',')[1]})()");
  const qrFile=path.join(temp,'student-qr.png');fs.writeFileSync(qrFile,Buffer.from(qrPng,'base64'));
  for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<800},student.sessionId);assert.equal(await student.run('document.documentElement.scrollWidth<=innerWidth'),true,'Responsive student profile');}
  fs.writeFileSync(path.join(__dirname,'student-profile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},student.sessionId)).data,'base64'));
  async function upload(p,selector,file){const doc=await send('DOM.getDocument',{},p.sessionId),node=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector},p.sessionId);await send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]},p.sessionId);}

  await officer.run("navigate('payments');document.querySelector('[data-action=channels]').click();if($('channelsForm').textContent.includes('Bank transfer'))throw Error('Bank transfer must be removed');$('channelsForm').elements.enabled0.checked=true;$('channelsForm').elements.name0.value='Organization Treasury';$('channelsForm').elements.account0.value='TEST-ACCOUNT';$('channelsForm').requestSubmit()");
  await until(student,"db.paymentChannels.GCash?.account==='TEST-ACCOUNT'");
  await officer.run("navigate('fees');document.querySelector('[data-action=fee]').click()");
  await officer.run(`$('feeForm').elements.name.value='Connected fee';$('feeForm').elements.amount.value='200';$('feeForm').elements.dueDate.value='2026-12-01';$('feeForm').elements.students.value='${studentId}';$('feeForm').requestSubmit()`);await until(officer,"db.fees.length===1");
  await student.run("navigate('fees')");await until(student,"db.fees.length===1&&document.querySelector('[data-action=pay]')!==null");
  assert.equal(await second.run('db.fees.length'),0,'Unassigned student cannot see fee');
  await student.run("document.querySelector('[data-action=pay]').click();$('paymentForm').requestSubmit(document.querySelector('[name=requestOnly]'))");await until(student,"db.payments.length===1&&$('modalTitle').textContent==='Payment ticket'");
  await student.run("document.querySelector('[data-action=submit-payment]').click()");
  await upload(student,'#paymentProofFile',path.resolve(__dirname,'../assets/payments/gcash.png'));
  await until(student,"$('paymentProofStatus').textContent.includes('Screenshot attached')");
  await student.run("$('submitPaymentForm').requestSubmit()");await until(student,"db.payments[0].status==='Pending'");
  await officer.run("navigate('payments')");await until(officer,"db.payments[0]?.status==='Pending'");
  await officer.run("document.querySelector('[data-action=ticket]').click()");
  await until(officer,"document.querySelector('.payment-proof img')?.naturalWidth>0");
  fs.writeFileSync(path.join(__dirname,'payment-proof-review.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},officer.sessionId)).data,'base64'));
  await officer.run("$('verifyForm').elements.note.value='Checked transfer';$('verifyForm').requestSubmit(document.querySelector('#verifyForm [value=Paid]'))");await until(officer,"db.payments[0].status==='Paid'");
  await student.run("$('modal').close()");await until(student,"db.payments[0].status==='Paid'");await admin.run("navigate('reports')");await until(admin,"db.payments[0]?.status==='Paid'");
  await until(officer,"$('modalTitle').textContent==='Payment receipt'");
  const receiptNumber=await officer.run('db.payments[0].receipt.number');
  await officer.run("$('modal').close()");
  await student.run("navigate('payments');document.querySelector('[data-action=receipt]').click()");
  assert.equal(await student.run("document.querySelector('.receipt-number').textContent"),receiptNumber);
  assert.equal(await student.run("document.querySelector('.payment-receipt').textContent.includes('Collector')&&document.querySelector('.payment-receipt').textContent.includes('2021-3090')"),true);
  fs.writeFileSync(path.join(__dirname,'issued-receipt.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},student.sessionId)).data,'base64'));
  const pdf=await send('Page.printToPDF',{printBackground:true},student.sessionId);assert.ok(pdf.data.length>1000);fs.writeFileSync(path.join(__dirname,'payment-receipt.pdf'),Buffer.from(pdf.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},student.sessionId);
  assert.equal(await student.run("$('modal').scrollWidth<=$('modal').clientWidth"),true,'Receipt fits mobile');
  await student.run("$('modal').close()");

  assert.equal(await second.run('db.payments.length'),0,'No cross-student payments');
  await officer.run("navigate('events');document.querySelector('[data-action=event][data-id=EVT-001]').click()");
  assert.equal(await officer.run("$('eventForm').elements.capacity===undefined"),true,'Capacity input removed');
  await until(officer,"$('eventCoverPreview').complete&&$('eventCoverPreview').naturalWidth>0");
  const doc=await send('DOM.getDocument',{},officer.sessionId),fileNode=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#eventCoverFile'},officer.sessionId);
  await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[path.resolve(__dirname,'../feats-logo.png')]},officer.sessionId);
  await until(officer,"$('eventCoverStatus').textContent.includes('Picture ready')");
  await officer.run("$('eventForm').requestSubmit()");
  await until(student,"db.events[0].coverImage?.startsWith('data:image/jpeg;base64,')");
  await until(admin,"db.events[0].coverImage?.startsWith('data:image/jpeg;base64,')");
  await officer.run("navigate('events');document.querySelector('[data-action=event][data-id=EVT-001]').click();document.querySelector('[data-cover-theme=assembly]').click();$('eventForm').requestSubmit()");
  await until(student,"db.events[0].coverImage==='/assets/events/assembly.svg'");
  await student.run("navigate('profile');$('profileCourse').value='BITM';$('profileCourseForm').requestSubmit()");
  await until(student,"currentUser.course==='BITM'");
  await until(officer,`db.users.find(u=>u.id==='${studentId}').course==='BITM'`);
  await student.run("navigate('events');document.querySelector('[data-action=register]').click()");await until(student,'db.registrations.length===1');
  const eventId=await student.run('db.registrations[0].eventId');await officer.run(`(async()=>{await syncWorkspace();await toggleCheckIn('${eventId}');})()`);await until(officer,`db.events.find(e=>e.id==='${eventId}').checkInOpen`);
  const code=await officer.run(`db.events.find(e=>e.id==='${eventId}').token`);
  await officer.run("navigate('attendance')");
  await upload(officer,'#studentQrFile',qrFile);
  await until(officer,`$('studentQrCode').value==='${personalQr}'`);
  await officer.run(`(async()=>{const picture=new Image();picture.src='data:image/png;base64,${qrPng}';await picture.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=280;canvas.getContext('2d').drawImage(picture,0,0);window.qrTestCanvas=canvas;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.qrTestStream=canvas.captureStream(10);return window.qrTestStream;}});$('studentQrCode').value='';await startScanner(true);})()`);
  await until(officer,`$('studentQrCode').value==='${personalQr}'`);
  assert.equal(await officer.run("qrTestStream.getTracks().every(track=>track.readyState==='ended')"),true,'Camera scanning releases tracks after detecting QR');
  for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<800},officer.sessionId);assert.equal(await officer.run('document.documentElement.scrollWidth<=innerWidth'),true,'Responsive officer QR check-in');}
  fs.writeFileSync(path.join(__dirname,'student-qr-checkin.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},officer.sessionId)).data,'base64'));

  await officer.run(`$('studentQrEvent').value='${eventId}';$('studentQrForm').requestSubmit()`);
  await until(officer,"$('confirmStudentCheckin')!==null");
  assert.equal(await officer.run("$('modalBody').textContent.includes('Student One')&&$('modalBody').textContent.includes('2021-3090')&&$('modalBody').textContent.includes('BITM')"),true,'Officer confirms the QR owner and current course');
  await officer.run("$('confirmStudentCheckin').click()");await until(student,'db.attendance.length===1');await until(officer,'db.attendance.length===1');await until(admin,'db.attendance.length===1');
  for(const p of [student,officer,admin]){await p.run("navigate('reports');document.querySelectorAll('[data-record-search]').forEach(e=>{e.value='2021 - 3090';e.dispatchEvent(new Event('input',{bubbles:true}))})");assert.equal(await p.run("[...document.querySelectorAll('.records-count')].every(e=>e.textContent==='1 of 1 records')"),true,'Identity searches work for each role');}
  await officer.run("navigate('payments');$('paymentFilter').value='Pending';$('paymentFilter').dispatchEvent(new Event('change',{bubbles:true}))");assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'0 of 0 records','Status filter hides verified ticket');
  await officer.run("$('paymentFilter').value='Paid';$('paymentFilter').dispatchEvent(new Event('change',{bubbles:true}));const search=document.querySelector('[data-record-search]');search.value='2021-3090';search.dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'1 of 1 records','Status and search combine');
  for(const p of [student,officer,admin]){for(const width of [390,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800},p.sessionId);await p.run("navigate('reports')");assert.equal(await p.run('document.documentElement.scrollWidth<=innerWidth'),true,'Responsive shared reports');}}
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false},student.sessionId);
  await student.run("navigate('events')");await until(student,"[...document.querySelectorAll('.event-cover>img')].every(img=>img.complete&&img.naturalWidth>0)");
  fs.writeFileSync(path.join(__dirname,'event-covers.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},student.sessionId)).data,'base64'));
  for(const width of [390,768,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800},student.sessionId);assert.equal(await student.run('document.documentElement.scrollWidth<=innerWidth'),true,'Event pictures fit viewport');}
  await send('Page.reload',{},student.sessionId);await until(student,"typeof currentUser!=='undefined'&&currentUser?.role==='student'");assert.equal(await student.run('db.payments[0].status'),'Paid','Session restored after reload');assert.equal(await student.run("'FEATS-STUDENT:'+currentUser.attendanceToken"),personalQr,'Same QR after reload');
  await student.run("$('signOut').click()");await until(student,'currentUser===null');await student.run("openAuth('login','student');$('authEmail').value='2021 - 3090';$('authPassword').value='Password123';$('authForm').requestSubmit()");await until(student,"currentUser?.role==='student'");
  for(const [p,role] of [[officer,'officer'],[admin,'admin']]){
   await p.run("$('signOut').click()");await until(p,'currentUser===null');
   await p.run(`openAuth('login','${role}');$('authEmail').value='my-${role}-01';$('authPassword').value='Password123';$('authForm').requestSubmit()`);await until(p,`currentUser?.role==='${role}'`);
  }
  for(const p of [student,officer,admin]){
   await p.run("navigate('reports')");
   assert.equal(await p.run("[...document.querySelectorAll('#content table')].every(table=>[...table.querySelectorAll('tbody tr:not([data-empty]):not([data-no-match])')].every(row=>row.cells.length===table.querySelectorAll('thead th').length))"),true,'Report headings match every record column');
  }
  // Exercise real records belonging to different sections, courses, and years.
  await student.run("saveAction('updateCourse',{course:'BITM',section:'A',year:'1st Year'})");
  await second.run("saveAction('updateCourse',{course:'BSIT',section:'B',year:'2nd Year'})");
  const secondId=await second.run('currentUser.id');
  await officer.run('syncWorkspace()');
  const extraFee=await officer.run(`(async()=>{const response=await saveAction('saveFee',{name:'Group filter fee',amount:150,dueDate:'2026-12-01',studentIds:['${secondId}']});if(!response)throw Error('Fee setup failed');return db.fees.find(fee=>fee.name==='Group filter fee').id})()`);
  await second.run(`saveAction('createPayment',{feeId:'${extraFee}',method:'Cash',externalReference:'Cash received'})`);
  await second.run(`saveAction('register',{eventId:'${eventId}'})`);
  await officer.run(`(async()=>{await syncWorkspace();await saveAction('checkIn',{code:'${code}',studentId:'${secondId}'});})()`);
  await officer.run("navigate('payments');$('paymentFilter').value='';$('paymentFilter').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-clear-record-filters]').click()");
  async function groupFilter(p,field,value){await p.run(`(()=>{const select=document.querySelector('[data-record-filter=${field}]');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'2 of 2 records','Staff see payments across all student groups');
  assert.equal(await officer.run("document.querySelector('.record-group-summary').textContent.includes('1 verified payment(s)')"),true,'Pending payment excluded from paid total');
  await groupFilter(officer,'course','BITM');await groupFilter(officer,'section','A');await groupFilter(officer,'year','1st Year');
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'1 of 2 records','Three identity filters combine exactly');
  await groupFilter(officer,'year','2nd Year');
  assert.equal(await officer.run("!document.querySelector('[data-no-match]').hidden"),true,'Conflicting group filters show no matches');
  await officer.run("render()");
  assert.equal(await officer.run("document.querySelector('[data-record-filter=year]').value"),'2nd Year','Group filters survive rerender');
  await officer.run("document.querySelector('[data-clear-record-filters]').click()");
  await groupFilter(officer,'course','BSIT');
  assert.equal(await officer.run("document.querySelector('.record-group-summary').textContent.includes('0 verified payment(s)')"),true,'Selected pending-only group has no verified payments');
  await officer.run("$('paymentFilter').value='Paid';$('paymentFilter').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'0 of 1 records','Group and Paid status filters combine');
  await officer.run("navigate('attendance');document.querySelector('[data-clear-record-filters]').click()");
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'2 of 2 records','Officer sees attendance across all groups');
  await groupFilter(officer,'section','B');await groupFilter(officer,'course','BSIT');await groupFilter(officer,'year','2nd Year');
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'1 of 2 records','Attendance filters select the correct group');
  assert.equal(await officer.run("document.querySelector('.record-group-summary').textContent.includes('1 check-in(s) from 1 student(s)')"),true,'Filtered attendance summary matches visible records');
  for(const width of [390,768,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800},officer.sessionId);assert.equal(await officer.run('document.documentElement.scrollWidth<=innerWidth'),true,'Staff group filters fit viewport');}
  await student.run("navigate('reports')");
  assert.equal(await student.run("document.querySelectorAll('[data-record-filter]').length"),0,'Student access remains personal');
  await admin.run("navigate('accounts');document.querySelector('[data-action=correct-student]').click()");
  assert.equal(await admin.run("$('correctStudentForm')!==null"),true,'Administrator can review a student identity correction form');
  await admin.run("$('modal').close()");
  // Exercise the management screens through their actual forms and controls.
  for(const [p,pages] of [[admin,['accounts','roster','monitoring','audit','notifications','account','backups']],[officer,['monitoring','roster','audit','notifications','account']]]){
   for(const next of pages){for(const width of [390,1440]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800},p.sessionId);
    await p.run("navigate('"+next+"')");
    assert.equal(await p.run('document.documentElement.scrollWidth<=innerWidth'),true,'Management '+next+' fits '+width);
   }}
  }
  await officer.run("saveAction('saveFee',{name:'Unpaid group fee',amount:80,dueDate:'2026-12-15',studentIds:db.users.filter(u=>u.role==='student').map(u=>u.id)})");
  await officer.run("navigate('monitoring')");await groupFilter(officer,'status','Unpaid');
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'2 of 4 records','Monitoring includes unpaid assignments without tickets');
  const otherEventId=await second.run("db.events.find(e=>e.id!=='"+eventId+"'&&e.published).id");
  await second.run("saveAction('register',{eventId:'"+otherEventId+"'})");
  await officer.run("(async()=>{await syncWorkspace();$('monitoringEvent').value='"+otherEventId+"';$('monitoringEvent').dispatchEvent(new Event('change',{bubbles:true}));})()");
  assert.equal(await officer.run("document.querySelectorAll('.records-count')[1].textContent"),'1 of 1 records','Registered student without attendance is listed');
  assert.equal(await officer.run("[...document.querySelectorAll('.records-block')][1].textContent.includes('Not checked in')"),true,'Monitoring labels missing check-in explicitly');
  await officer.run("$('includeUnregistered').checked=true;$('includeUnregistered').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await officer.run("document.querySelectorAll('.records-count')[1].textContent"),'2 of 2 records','Unregistered students can be included');
  await officer.run("downloadFile=(name,content,type)=>{window.lastDownload={name,content,type};};navigate('reports');document.querySelector('[data-action=export]').click();$('filteredExportForm').elements.type.value='Payment';$('filteredExportForm').elements.course.value='BITM';$('filteredExportForm').elements.status.value='Paid';$('filteredExportForm').requestSubmit()");
  await until(officer,"window.lastDownload?.name==='FEATS-filtered-records.csv'");
  assert.equal(await officer.run("lastDownload.content.includes('Student One')&&!lastDownload.content.includes('Student Two')"),true,'Filtered report exports matching paid students only');
  await officer.run("navigate('payments');document.querySelector('[data-clear-record-filters]').click();$('paymentFilter').value='';$('paymentFilter').dispatchEvent(new Event('change',{bubbles:true}))");
  await groupFilter(officer,'course','BSIT');
  await officer.run("document.querySelector('[data-export-table]').click()");
  assert.equal(await officer.run("lastDownload.content.includes('Student Two')&&!lastDownload.content.includes('Student One')"),true,'Visible CSV follows table filters');
  await officer.run("document.querySelector('input[data-record-date=from]').value='2099-01-01';document.querySelector('input[data-record-date=from]').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await officer.run("document.querySelector('.records-count').textContent"),'0 of 2 records','Date range combines with group filters');
  assert.equal(await officer.run("buildExportRows({type:'Payment',from:'2099-01-01'}).length"),1,'Filtered export respects from date');
  assert.equal(await officer.run("buildExportRows({type:'Attendance',eventId:'"+eventId+"'}).length"),3,'Filtered export respects event selection');
  const rosterFile=path.join(temp,'roster.csv');fs.writeFileSync(rosterFile,'schoolId,name,course,section,year,email,enrollment\r\n2021-3090,Student One,BITM,A,1st Year,student@example.test,Enrolled\r\n');
  await admin.run("navigate('roster');document.querySelector('[data-action=import-roster]').click()");
  await upload(admin,'#rosterFile',rosterFile);await admin.run("$('rosterImportForm').requestSubmit()");
  await until(admin,"document.querySelector('[data-action=confirm-roster]')!==null");
  await admin.run("document.querySelector('[data-action=confirm-roster]').click()");await until(admin,'db.roster.length===1');
  await student.run("syncWorkspace()");await student.run("navigate('profile')");
  assert.equal(await student.run("currentUser.enrollmentStatus==='Verified'&&$('profileCourse').disabled"),true,'Imported roster verifies and locks student identity');
  const ExcelJS=require('exceljs'),workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Roster');sheet.addRow(['schoolId','name','course','section','year','email','enrollment']);sheet.addRow(['2022-4090','Student Two','BSIT','B','2nd Year','second@example.test','Enrolled']);
  const xlsxFile=path.join(temp,'roster.xlsx');await workbook.xlsx.writeFile(xlsxFile);
  await admin.run("document.querySelector('[data-action=import-roster]').click()");await upload(admin,'#rosterFile',xlsxFile);await admin.run("$('rosterImportForm').requestSubmit()");
  await until(admin,"document.querySelector('[data-action=confirm-roster]')!==null");await admin.run("document.querySelector('[data-action=confirm-roster]').click()");await until(admin,'db.roster.length===2');
  assert.equal(await admin.run("db.users.find(u=>u.email==='second@example.test').enrollmentStatus"),'Verified','Native Excel import validates and verifies an additional student');
  await officer.run("navigate('notifications');$('announcementForm').elements.title.value='UI announcement';$('announcementForm').elements.message.value='Organization reminder';$('announcementForm').elements.audience.value='student';$('announcementForm').requestSubmit()");
  await until(officer,"$('toast').textContent==='Announcement published.'");await student.run("syncWorkspace();navigate('notifications')");
  await until(student,"db.notifications.some(n=>n.title==='UI announcement')");
  await student.run("navigate('notifications');document.querySelector('[data-action=read-notifications]').click()");
  await until(student,"db.notifications.every(n=>n.read)");
  await admin.run("(async()=>{await api('signup',{name:'Pending UI Officer',email:'pending-ui@example.test',password:'Password123',role:'officer',staffCode:'PENDING-UI'});await syncWorkspace();navigate('accounts');})()");
  const pendingId=await admin.run("db.users.find(u=>u.email==='pending-ui@example.test').id");
  await admin.run("document.querySelector('[data-action=account-status][data-id=\""+pendingId+"\"]').click();$('confirmAccountStatus').click()");
  await until(admin,"db.users.find(u=>u.email==='pending-ui@example.test').status==='active'");
  await second.run("$('signOut').click()");await until(second,'currentUser===null');
  await second.run("$('forgotPassword').click();$('requestRecoveryForm').elements.identifier.value='second@example.test';$('requestRecoveryForm').requestSubmit()");
  await until(second,"$('recoveryRequestStatus').textContent.includes('administrator')");
  await admin.run("syncWorkspace()");await admin.run("navigate('accounts');document.querySelector('[data-action=issue-reset]').click();$('issueResetForm').elements.reason.value='Verified identity in person';$('issueResetForm').requestSubmit()");
  await until(admin,"$('modalTitle').textContent==='One-time recovery code'");
  const resetCode=await admin.run("$('modalBody').querySelector('input').value");
  await second.run("$('resetPasswordForm').elements.code.value="+JSON.stringify(resetCode)+";$('resetPasswordForm').elements.password.value='Recovered123';$('resetPasswordForm').elements.confirm.value='Recovered123';$('resetPasswordForm').requestSubmit()");
  await until(second,"$('toast').textContent.includes('Password reset')");
  await second.run("openAuth('login','student');$('authEmail').value='second@example.test';$('authPassword').value='Recovered123';$('authForm').requestSubmit()");await until(second,"currentUser?.role==='student'");
  await second.run("navigate('account');$('changePasswordForm').elements.currentPassword.value='Recovered123';$('changePasswordForm').elements.newPassword.value='Password123';$('changePasswordForm').elements.confirm.value='Password123';$('changePasswordForm').requestSubmit()");
  await until(second,'currentUser===null');
  await admin.run("$('modal').close();downloadFile=(name,content,type)=>{window.lastDownload={name,content,type};};navigate('backups');document.querySelector('[data-action=create-backup]').click();$('backupForm').elements.password.value='Password123';$('backupForm').requestSubmit()");
  await until(admin,"window.lastDownload?.name.startsWith('feats-manual-')");
  const backupFile=path.join(temp,'ui-backup.json');fs.writeFileSync(backupFile,await admin.run('lastDownload.content'));
  await admin.run("document.querySelector('[data-action=upload-backup]').click()");await upload(admin,'#backupFile',backupFile);
  await admin.run("$('backupForm').elements.password.value='Password123';$('backupForm').requestSubmit()");
  await until(admin,"$('restoreBackupForm')!==null");
  await admin.run("$('restoreBackupForm').elements.confirm.value='RESTORE';$('restoreBackupForm').requestSubmit()");await until(admin,'currentUser===null');
  await admin.run("openAuth('login','admin');$('authEmail').value='my-admin-01';$('authPassword').value='Password123';$('authForm').requestSubmit()");await until(admin,"currentUser?.role==='admin'");
  assert.equal(await admin.run("db.auditLog.some(entry=>entry.action==='restoreBackup')"),true,'Restore through UI preserves audit history and signs out');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},admin.sessionId);
  for(const [next,file] of [['accounts','admin-management.png'],['monitoring','staff-monitoring.png'],['roster','school-roster.png']]){
   await admin.run("navigate('"+next+"')");
   fs.writeFileSync(path.join(__dirname,file),Buffer.from((await send('Page.captureScreenshot',{format:'png'},admin.sessionId)).data,'base64'));
  }
  assert.deepEqual(errors,[]);console.log('PASS: personal QR image/camera decoding, screenshot upload and review, profile course update, independent browser sessions, signup/login, automatic student/officer/adviser updates, fee assignment, payment verification, registration/check-in, private records, search, reload, responsive layouts, staff approvals, roster import, unpaid/missing attendance monitoring, filtered exports, notifications, recovery forms, account settings, and backup restore.');
  await send('Browser.close').catch(()=>{});
 }finally{ws?.close();browser.kill();await new Promise(r=>server.close(r));try{fs.rmSync(temp,{recursive:true,force:true});}catch{}}
})().catch(error=>{console.error(error);process.exitCode=1;});
