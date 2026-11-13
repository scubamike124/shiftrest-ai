import { Webhook } from 'standardwebhooks';
import { readAIRequestBody } from '@/lib/ai/request.server';
export class WebhookError extends Error { constructor(public code:string,message:string){super(message);} }
export async function verifyWebhookRequest<T>({req,secret,parser}:{req:Request;secret:string;parser:(body:string)=>T}) {
  const bounded=await readAIRequestBody(req,256*1024);
  if('response' in bounded)throw new WebhookError('invalid_payload','Invalid webhook body');
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bounded.body);
  const id=req.headers.get('webhook-id') || req.headers.get('svix-id') || '';
  const timestamp=req.headers.get('webhook-timestamp') || req.headers.get('svix-timestamp') || '';
  const signature=req.headers.get('webhook-signature') || req.headers.get('svix-signature') || '';
  try {new Webhook(secret.replace(/^v1,/, '')).verify(body,{'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signature});}
  catch {throw new WebhookError('invalid_signature','Invalid webhook signature');}
  try{return {payload:parser(body),timestamp,id};}
  catch {throw new WebhookError('invalid_payload','Invalid webhook payload');}
}
