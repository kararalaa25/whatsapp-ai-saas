import { equalSecret,requireProviderRelease } from '@/utils/cloud/security'
import { createCloudRuntime } from '@/utils/cloud/runtime'
import { processCloudJob } from '@/utils/cloud/engine'
export async function POST(request:Request){
 const supplied=request.headers.get('authorization')?.match(/^Bearer ([^\s]{32,256})$/i)?.[1]??null
 if(!equalSecret(supplied,process.env.CLOUD_WORKER_SECRET))return new Response('Forbidden',{status:403,headers:{'Cache-Control':'private, no-store'}})
 try{requireProviderRelease();const runtime=createCloudRuntime();return Response.json(await processCloudJob(runtime.engine),{headers:{'Cache-Control':'private, no-store'}})}catch{return new Response('Cloud processing unavailable',{status:503,headers:{'Cache-Control':'private, no-store'}})}
}
