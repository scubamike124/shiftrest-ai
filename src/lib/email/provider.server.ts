export type ProviderEmail = {
  to: string; from: string; subject: string; html: string; text: string;
  reply_to?: string; idempotency_key?: string; message_id?: string;
  unsubscribe_token?: string; [key: string]: unknown;
};
export async function sendProviderEmail(payload: ProviderEmail, options: {apiKey:string}) {
  if (!options.apiKey) throw new Error('Email provider is not configured');
  const idempotencyKey = payload.idempotency_key || payload.message_id;
  if (!idempotencyKey) throw new Error('Email idempotency key is required');
  let html = payload.html, text = payload.text;
  let headers: Record<string, string> | undefined;
  if (payload.unsubscribe_token) {
    const base = new URL(process.env.PUBLIC_APP_URL || '');
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Email public URL is not configured');
    const url = new URL('/email/unsubscribe', base.origin);
    url.searchParams.set('token', payload.unsubscribe_token);
    const safeUrl = url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    html += `<p><a href="${safeUrl}">Unsubscribe from RestPilot emails</a></p>`;
    text += `\n\nUnsubscribe: ${url.href}`;
    headers = {'List-Unsubscribe': `<${url.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'};
  }
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', signal:AbortSignal.timeout(20_000),
    headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify({from:payload.from,to:[payload.to],subject:payload.subject,html,text,...(headers ? {headers} : {}),
      ...(payload.reply_to ? {reply_to:payload.reply_to} : {}),
    }),
  });
  if (!response.ok) {
    const retry=Number(response.headers.get('Retry-After'));
    throw Object.assign(new Error(`Email provider rejected request (${response.status})`), {
      status:response.status,retryAfterSeconds:Number.isFinite(retry)&&retry>0?retry:60,
    });
  }
  const result = await response.json() as {id?:unknown};
  if (typeof result.id !== 'string' || !result.id) throw new Error('Email provider returned no delivery id');
  return {success:true,message_id:result.id};
}
