import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import OpenAI, { toFile } from 'openai'
import { parseBuffer } from 'music-metadata'
import { limitedBytes, type MetaClient, type ProviderIO } from './meta'
import { requireProviderRelease } from './security'

export class AudioReviewRequired extends Error {}
export const MAX_AUDIO_BYTES=16*1024*1024
export const MAX_AUDIO_SECONDS=120
export const IRAQI_TRANSCRIPTION_PROMPT='Transcribe the recording faithfully in its original language. It may contain Iraqi Arabic, regional Iraqi expressions, English product names, or code-switching. Preserve those words; do not translate, answer, invent prices or fill inaudible gaps. For unintelligible audio return [inaudible].'
export type AudioFile={bytes:Uint8Array;mime:string;name:string;durationSeconds:number}
export type Transcript={text:string;durationSeconds:number}
export type Transcriber=(audio:AudioFile)=>Promise<Transcript>
function normalizedHash(value:string){
 if(/^[a-f0-9]{64}$/i.test(value))return Buffer.from(value,'hex')
 if(/^[A-Za-z0-9+/]{43}=$/.test(value))return Buffer.from(value,'base64')
 throw new AudioReviewRequired('Audio integrity unavailable')
}
function audioKind(bytes:Uint8Array,mime:string){
 const b=Buffer.from(bytes);const type=mime.split(';')[0].trim().toLowerCase()
 const formats:Record<string,{extension:string;valid:boolean}>={
  'audio/ogg':{extension:'ogg',valid:b.subarray(0,4).toString()==='OggS'},
  'audio/mpeg':{extension:'mp3',valid:b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&224)===224)},
  'audio/mp4':{extension:'mp4',valid:b.subarray(4,8).toString()==='ftyp'},
  'audio/wav':{extension:'wav',valid:b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE'},
  'audio/webm':{extension:'webm',valid:b.subarray(0,4).equals(Buffer.from([26,69,223,163]))},
 }
 const format=formats[type]
 if(!format?.valid)throw new AudioReviewRequired('Audio format requires human review')
 return {mime:type,name:`voice.${format.extension}`}
}
export async function retrieveAudio(meta:MetaClient,io:ProviderIO,id:string,phoneId:string,token:string,eventHash:string,maximumSeconds=MAX_AUDIO_SECONDS):Promise<AudioFile>{
 const metadata=await meta.media(id,phoneId,token)
 const url=new URL(metadata.url)
 const host=url.hostname.toLowerCase()
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['fbcdn.net','facebook.com','fbsbx.com'].some(domain=>host===domain||host.endsWith('.'+domain)))throw new AudioReviewRequired('Untrusted media location')
 const response=await io(url.toString(),{headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw Error('Audio download unavailable')
 const bytes=await limitedBytes(response,MAX_AUDIO_BYTES)
 if(bytes.length!==metadata.file_size)throw new AudioReviewRequired('Audio size mismatch')
 const digest=createHash('sha256').update(bytes).digest()
 if(![metadata.sha256,eventHash].every(hash=>timingSafeEqual(digest,normalizedHash(hash))))throw new AudioReviewRequired('Audio integrity mismatch')
 const kind=audioKind(bytes,metadata.mime_type)
 let parsed
 try{parsed=await parseBuffer(bytes,{mimeType:kind.mime,size:bytes.length},{duration:true,skipCovers:true})}catch{throw new AudioReviewRequired('Audio cannot be decoded')}
 const durationSeconds=parsed.format.duration
 if(!durationSeconds||!Number.isFinite(durationSeconds)||durationSeconds>maximumSeconds)throw new AudioReviewRequired('Audio duration requires human review')
 return {bytes,...kind,durationSeconds}
}
export function validateTranscript(text:string,durationSeconds:number,confidence?:number[]):Transcript{
 const clean=text.trim()
 if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>MAX_AUDIO_SECONDS||!clean||Array.from(clean).length>4096||/\[inaudible\]|\u0000/i.test(clean))throw new AudioReviewRequired('Audio requires human review')
 // Provisional conservative routing, not a claim of acoustic correctness. Tune
 // only after the consented Iraqi Arabic/code-switching evaluation passes.
 if(confidence&&(!confidence.length||confidence.some(n=>!Number.isFinite(n)||n < -3)||confidence.reduce((a,b)=>a+b,0)/confidence.length < -1))throw new AudioReviewRequired('Low-confidence audio requires human review')
 return {text:clean,durationSeconds}
}
export function createOpenAITranscriber(apiKey:string,model:'gpt-4o-transcribe'|'gpt-4o-mini-transcribe'|'whisper-1'='gpt-4o-transcribe'):Transcriber{
 return async audio=>{
  requireProviderRelease()
  if(!apiKey||audio.bytes.length>MAX_AUDIO_BYTES||!Number.isFinite(audio.durationSeconds)||audio.durationSeconds<=0||audio.durationSeconds>MAX_AUDIO_SECONDS)throw Error('Transcription unavailable')
  const client=new OpenAI({apiKey,timeout:30000,maxRetries:0})
  const file=await toFile(audio.bytes,audio.name,{type:audio.mime})
  if(model==='whisper-1'){
   const result=await client.audio.transcriptions.create({file,model,response_format:'verbose_json',prompt:IRAQI_TRANSCRIPTION_PROMPT,temperature:0})
   if(!result.segments?.length||result.segments.some(s=>s.no_speech_prob>0.6))throw new AudioReviewRequired('Audio requires human review')
   return validateTranscript(result.text,result.duration,result.segments.map(s=>s.avg_logprob))
  }
  const result=await client.audio.transcriptions.create({file,model,response_format:'json',include:['logprobs'],prompt:IRAQI_TRANSCRIPTION_PROMPT,temperature:0})
  return validateTranscript(result.text,audio.durationSeconds,result.logprobs?.map(p=>p.logprob??-Infinity)??[])
 }
}
