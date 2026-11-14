// Public SDK data only. OAuth code/PIN are submitted to the authenticated server,
// never stored in localStorage or interpreted as verified business ownership.
export type MetaSDK={init(options:{appId:string;version:string;cookie:boolean;xfbml:boolean}):void;login(callback:(result:{authResponse?:{code?:string};status?:string})=>void,options:unknown):void}
export function collectEmbeddedSignup(sdk:MetaSDK,events:Pick<Window,'addEventListener'|'removeEventListener'>,configId:string,signal:AbortSignal):Promise<{code:string;phoneId:string;wabaId:string}>{
 return new Promise((resolve,reject)=>{
  let code:string|undefined;let phoneId:string|undefined;let wabaId:string|undefined;let ended=false
  const timer=setTimeout(()=>finish(Error('Signup timed out')),120000)
  function finish(error?:Error){if(ended)return;ended=true;clearTimeout(timer);events.removeEventListener('message',message);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve({code:code!,phoneId:phoneId!,wabaId:wabaId!})}
  const abort=()=>finish(Error('Signup canceled'))
  function ready(){if(code&&phoneId&&wabaId)finish()}
  function message(event:MessageEvent){
   if(!['https://www.facebook.com','https://web.facebook.com','https://facebook.com'].includes(event.origin))return
   try{
    if(typeof event.data!=='string'||event.data.length>8192)return
    const value=JSON.parse(event.data)
    if(value.type!=='WA_EMBEDDED_SIGNUP')return
    if(value.event==='CANCEL'||value.event==='ERROR'){finish(Error('Signup canceled'));return}
    if(value.event==='FINISH'&&/^\d{1,32}$/.test(value.data?.phone_number_id)&&/^\d{1,32}$/.test(value.data?.waba_id)){
     phoneId=value.data.phone_number_id;wabaId=value.data.waba_id;ready()
    }
   }catch{/* Ignore malformed or unrelated window messages. */}
  }
  events.addEventListener('message',message)
  signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted){abort();return}
  try{sdk.login(result=>{const value=result.authResponse?.code;if(!value||value.length>4096||/\s/.test(value)){finish(Error('Signup canceled'));return}code=value;ready()}, {config_id:configId,response_type:'code',override_default_response_type:true,extras:{setup:{},sessionInfoVersion:'3'}})}catch{finish(Error('Signup unavailable'))}
 })
}
