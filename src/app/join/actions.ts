'use server'
import { acceptInvitation } from '@/app/dashboard/team/actions'
export async function joinWorkspace(token:string){return acceptInvitation(token)}
