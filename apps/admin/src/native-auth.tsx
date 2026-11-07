import React,{useEffect,useState} from 'react';
import {archiveUnlinkedDrafts,checkNativeInstallation,sendNativeProject} from './native-project.js';

export type NativeAuthStatus={state:'checking'|'signed_out'|'pending'|'verification_pending'|'authorized'|'error';login?:string;userCode?:string;message?:string;project?:{state:'none'|'checking'|'creating'|'ready'|'error';owner?:string;name?:string;message?:string}};
type NativeBridge={postMessage:(message:string)=>void;onmessage:((event:{data:string})=>void)|null};
declare global { interface Window {StudioNativeAuth?:NativeBridge} }

export function installationMessage(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(message.includes('no installation of this app'))return 'اتصال این برنامه برای حساب فعلی در دسترس نیست. ورود به GitHub به‌تنهایی نصب برنامه را انجام نمی‌دهد؛ پس از فراهم‌شدن دسترسی، این بررسی را دوباره اجرا کنید.';
 if(message.includes('lacks Repository creation: write'))return 'مجوز ساخت مخزن برای این برنامه تأیید نشده است. تا زمان تأیید این مجوز، مخزنی ساخته نمی‌شود.';
 if(message.includes('lacks Contents: write'))return 'مجوز خواندن و نوشتن محتوای مخزن تأیید نشده است. تا زمان تأیید این مجوز، پروژه آماده نمی‌شود.';
 return message||'وضعیت نصب و مجوزهای GitHub بررسی نشد.';
}

export function NativeAuthGate({children}:{children:React.ReactNode}){
 const bridge=typeof window==='undefined'?undefined:window.StudioNativeAuth;
 const [status,setStatus]=useState<NativeAuthStatus>(()=>bridge?{state:'checking'}:{state:'signed_out'});
 const [repositoryName,setRepositoryName]=useState('');
 const [setupNotice,setSetupNotice]=useState('');
 const [installationBusy,setInstallationBusy]=useState(false);
 const [browserMode]=useState(()=>!bridge);
 const requestSequence=React.useRef(0);
 useEffect(()=>{if(status.project?.name)setRepositoryName(status.project.name)},[status.project?.name]);
 useEffect(()=>{
  if(!bridge)return;
  const receive=(event:{data:string})=>{
   try{const response=JSON.parse(event.data) as {source?:string;requestId?:string;status?:NativeAuthStatus};
    if(response.source==='studio-native-project'){window.dispatchEvent(new CustomEvent('studio-native-project-response',{detail:response}));return}
    if(response.source==='studio-native-auth'&&response.status&&['checking','signed_out','pending','verification_pending','authorized','error'].includes(response.status.state))setStatus(response.status);
   }catch{setStatus({state:'error',message:'وضعیت ورود امن دستگاه خوانده نشد.'})}
  };
  bridge.onmessage=receive;
  const update=()=>{requestSequence.current+=1;bridge.postMessage(JSON.stringify({action:'status',requestId:String(requestSequence.current)}))};
  update();
  const timer=window.setInterval(update,800);
  window.addEventListener('focus',update);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',update);if(bridge.onmessage===receive)bridge.onmessage=null};
 },[bridge]);
 const send=(action:'begin'|'logout')=>{bridge?.postMessage(JSON.stringify({action,requestId:String(++requestSequence.current)}))};

 if(browserMode)return <><div className="browser-auth-notice" role="status">ورود GitHub داخل برنامهٔ Android انجام می‌شود. این نسخهٔ مرورگر از API محلی همین دستگاه استفاده می‌کند.</div>{children}</>;
 if(status.state!=='authorized')return <main className="native-auth-page" dir="rtl">
  <section className="native-auth-card" aria-labelledby="native-auth-title">
   <span className="native-auth-brand">astro <span>/ studio</span></span>
   <h1 id="native-auth-title">ورود به Astro Static Studio</h1>
   <p className="native-auth-intro">برای اتصال حساب GitHub، ورود را آغاز کنید. تأیید در مرورگر امن GitHub انجام می‌شود.</p>
   {status.state==='checking'&&<p className="native-auth-message" role="status">{status.message||'در حال بررسی ورود ذخیره‌شده در این دستگاه…'}</p>}
   {status.state==='signed_out'&&<button className="native-auth-primary" type="button" onClick={()=>send('begin')}>ورود با GitHub</button>}
   {status.state==='pending'&&<div className="native-auth-pending" role="status"><p>مرورگر GitHub باز شد. این کد را در صفحهٔ GitHub وارد کنید و دسترسی برنامه را تأیید کنید.</p>{status.userCode&&<strong className="native-auth-code" dir="ltr">{status.userCode}</strong>}<p>پس از تأیید به این برنامه برگردید؛ وضعیت ورود به‌صورت خودکار بررسی می‌شود.</p><button className="native-auth-secondary" type="button" onClick={()=>send('logout')}>لغو ورود</button></div>}
   {status.state==='verification_pending'&&<div className="native-auth-pending" role="status"><p>{status.message||'مجوز GitHub ذخیره شده، اما هویت حساب هنوز تأیید نشده است.'}</p><p>تا وقتی نام حساب از GitHub تأیید نشود، برنامه ورود را برقرارشده نشان نمی‌دهد.</p><button className="native-auth-primary" type="button" onClick={()=>send('begin')}>بررسی دوبارهٔ حساب GitHub</button><button className="native-auth-secondary" type="button" onClick={()=>send('logout')}>خروج از این دستگاه</button></div>}
   {status.state==='error'&&<><p className="native-auth-message" role="alert">{status.message||'ورود GitHub انجام نشد.'}</p><button className="native-auth-primary" type="button" onClick={()=>send('begin')}>تلاش دوباره</button></>}
   <p className="native-auth-note">پس از ورود، می‌توانید یک مخزن خصوصی خالی به نام دلخواه خود بسازید. مخزن‌های موجود به‌صورت خودکار انتخاب یا تغییر نمی‌کنند.</p>
  </section>
 </main>;

 if(status.project?.state!=='ready')return <main className="native-auth-page" dir="rtl">
  <section className="native-auth-card" aria-labelledby="native-project-title">
   <span className="native-auth-brand">astro <span>/ studio</span></span>
   <header className="native-session-bar"><div><strong>اتصال GitHub برقرار است</strong><span dir="ltr">@{status.login}</span></div><button type="button" disabled={status.project?.state==='creating'} onClick={()=>send('logout')}>خروج از این دستگاه</button></header>
   <h1 id="native-project-title">ساخت پروژهٔ خصوصی</h1>
   {status.project?.state==='checking'&&<p role="status">{status.project.message||'در حال بررسی پروژهٔ ذخیره‌شده…'}</p>}
   {status.project?.state==='creating'&&<p role="status">{status.project.message||'در حال آماده‌سازی پروژه…'}</p>}
   {status.project?.state==='error'&&<p role="alert">{status.project.message||'آماده‌سازی پروژه کامل نشد.'} اگر مخزن ایجاد شده باشد، با همان نام تلاش دوباره فقط محتوای اولیهٔ خالی را اضافه می‌کند و دادهٔ موجود را جایگزین نمی‌کند.</p>}
   {setupNotice&&<p role="alert">{setupNotice}</p>}
   <button className="native-auth-secondary" type="button" disabled={installationBusy} onClick={async()=>{setInstallationBusy(true);try{setSetupNotice(await checkNativeInstallation())}catch(error){setSetupNotice(installationMessage(error))}finally{setInstallationBusy(false)}}}>{installationBusy?'در حال بررسی دسترسی…':'بررسی نصب و مجوزهای GitHub'}</button>
   {status.project?.state!=='checking'&&status.project?.state!=='creating'&&<form onSubmit={event=>{event.preventDefault();if(!archiveUnlinkedDrafts()){setSetupNotice('پیش‌نویس قبلی به‌طور امن جداگانه ذخیره نشد؛ ساخت پروژه متوقف شد تا چیزی از بین نرود. فضای مرورگر را بررسی کنید و دوباره تلاش کنید.');return}setSetupNotice('پیش‌نویس‌های قبلی فقط روی همین دستگاه نگه داشته می‌شوند و خودکار به مخزن منتقل نمی‌شوند.');sendNativeProject('createProject',{name:repositoryName.trim()})}}>
    <label htmlFor="native-project-name">نام مخزن خصوصی</label>
    <input id="native-project-name" autoComplete="off" value={repositoryName} onChange={event=>setRepositoryName(event.target.value.toLowerCase())} placeholder="my-astro-site" pattern="[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?" required maxLength={100} readOnly={Boolean(status.project?.name)}/>
    <p className="native-auth-note">{status.project?.name?`مخزن خصوصی ${status.project.name} قبلاً به‌صورت امن به این دستگاه متصل شده است. ادامه فقط راه‌اندازی همین مخزن را از سر می‌گیرد و فایل موجود را جایگزین نمی‌کند.`:`با فشردن دکمه، تأیید می‌کنید مخزن خصوصی تازه‌ای با همین نام در حساب @${status.login} ساخته شود. نام باید یکتا باشد. مخزن موجود انتخاب نمی‌شود و تغییر نمی‌کند. پیش‌نویس‌های قبلی روی دستگاه می‌مانند و خودکار منتقل نمی‌شوند.`}</p>
    <button className="native-auth-primary" type="submit">{status.project?.name?`ادامهٔ راه‌اندازی «${status.project.name}»`:`ساخت مخزن خصوصی «${repositoryName||'…'}»`}</button>
   </form>}
   <p className="native-auth-note">ورود به حساب GitHub و دسترسی به برنامه دو مرحلهٔ جدا هستند. اگر اتصال برای این حساب در دسترس نباشد، پروژه ساخته نمی‌شود؛ می‌توانید بعداً وضعیت را دوباره بررسی کنید.</p>
   <p className="native-auth-note">ساخت پروژه به مجوزهای Repository creation و Contents برای خواندن و نوشتن نیاز دارد. فقط فایل محتوای خالی نسخهٔ ۲ ذخیره می‌شود؛ قالب سایت، رسانه و انتشار هنوز متصل نیستند.</p>
  </section>
 </main>;
 return <>
  <header className="native-session-bar" dir="rtl"><div><strong>اتصال GitHub برقرار است · پروژهٔ خصوصی متصل است</strong><span dir="ltr">@{status.login} / {status.project?.name}</span></div><button type="button" onClick={()=>send('logout')}>خروج از این دستگاه</button></header>
  <p className="native-preview-notice" role="status" dir="rtl">محتوای نسخهٔ ۲ از مخزن خصوصی خوانده و ذخیره می‌شود؛ هر ذخیره با بررسی نسخه انجام می‌شود. ساخت خروجی سایت، رسانه و انتشار هنوز به این نسخه متصل نیست.</p>
  {children}
 </>;
}
