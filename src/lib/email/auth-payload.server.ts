type HookPayload={user:{email:string;new_email?:string};email_data:{email_action_type:string;token?:string;token_new?:string;token_hash?:string;token_hash_new?:string}};
export function authDeliveries(raw: unknown) {
  const p=raw as HookPayload;
  if(!p?.user?.email || !p.email_data || typeof p.email_data.email_action_type!=='string')throw new Error('Invalid auth email payload');
  const d=p.email_data,type=d.email_action_type;
  const entry=(email:string,token:string|undefined,hash:string|undefined)=>{
    if(typeof email!=='string'||!email.includes('@')|| (type==='reauthentication' ? !token : !hash))throw new Error('Invalid auth email fields');
    return {email,token,hash,type,oldEmail:p.user.email,newEmail:p.user.new_email};
  };
  if(type==='email_change') {
    if(!p.user.new_email)throw new Error('Missing new email');
    // Supabase's historical field naming is intentionally reversed.
    if(d.token_hash_new && d.token_hash)return [entry(p.user.email,d.token,d.token_hash_new),entry(p.user.new_email,d.token_new,d.token_hash)];
    return [entry(p.user.new_email,d.token_new||d.token,d.token_hash)];
  }
  return [entry(p.user.email,d.token,d.token_hash)];
}
