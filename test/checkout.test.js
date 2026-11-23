import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import handler from '../api/index.js';
import { validCpf, customerFrom, createCharge, getCharge, signOrder, verifyOrder, reviewMode } from '../lib/checkout.js';

const input={name:'Pessoa de Teste',email:'aluno@example.com',emailConfirmation:'aluno@example.com',document:'52998224725',phone:'11999999999',accepted:true,requestId:'10000000-0000-4000-8000-000000000001'};
const order={id:'ch_test',status:'pending',method:'pix',amount:397,external_id:'rota-'+input.requestId,metadata:{product:'rota-black-2026'},livemode:true,pix:{code:'000201TEST',qr_code_image:'data:image/png;base64,aGVsbG8=',expires_at:new Date(Date.now()+1800000).toISOString()}};

test('valida CPF, confirmação de e-mail, celular e ciência do prazo',()=>{
  assert.equal(validCpf(input.document),true);assert.equal(validCpf('11111111111'),false);assert.equal(validCpf('52998224724'),false);
  assert.throws(()=>customerFrom({...input,emailConfirmation:'outro@example.com'}),/iguais/);
  assert.throws(()=>customerFrom({...input,accepted:false}),/prazo/);
  assert.throws(()=>customerFrom({...input,phone:'123'}),/celular/);
});

test('sessão adulterada e expirada é recusada',()=>{
  process.env.ATLAS_SECRET_KEY='test-key-no-live-requests';delete process.env.ORDER_SIGNING_SECRET;
  const token=signOrder(order);assert.equal(verifyOrder(token).id,order.id);
  assert.throws(()=>verifyOrder(token+'x'),/inválida/);
  const payload=Buffer.from(JSON.stringify({id:order.id,order:order.external_id,exp:0})).toString('base64url');
  const expired=payload+'.'+createHmac('sha256',process.env.ATLAS_SECRET_KEY).update(payload).digest('base64url');
  assert.throws(()=>verifyOrder(expired),/expirou/);
});

test('contrato Atlas: preço fixo, idempotência estável e consulta segura',async()=>{
  const original=globalThis.fetch;delete process.env.LOCAL_REVIEW;let captured=[];
  globalThis.fetch=async(url,options)=>{captured.push({url,options});return new Response(JSON.stringify(order),{status:200});};
  try{
    const first=await createCharge({...input,amount:1});await createCharge(input);
    const body=JSON.parse(captured[0].options.body);assert.equal(body.amount,397);assert.equal(body.items[0].unit_amount,397);assert.equal(body.method,'pix');assert.equal(body.customer.document,input.document);assert.equal(body.customer.phone,input.phone);
    assert.equal(captured[0].options.headers['Idempotency-Key'],captured[1].options.headers['Idempotency-Key']);assert.match(body.checkout_url,/\/checkout$/);
    assert.equal('customer' in first,false);assert.equal('fee' in first,false);assert.equal('token' in first,true);
    await getCharge(first.token);assert.equal(captured.at(-1).url,'https://atlaspags.com/api/v1/charges/ch_test');
    globalThis.fetch=async()=>new Response(JSON.stringify({...order,status:'paid',amount:1}));await assert.rejects(getCharge(first.token),/validar/);
    globalThis.fetch=async()=>new Response(JSON.stringify({...order,status:'paid',metadata:{product:'other'}}));await assert.rejects(getCharge(first.token),/validar/);
    globalThis.fetch=async()=>new Response(JSON.stringify({...order,status:'paid',livemode:false}));await assert.rejects(getCharge(first.token),/validar/);
    globalThis.fetch=async()=>new Response('{}',{status:503});await assert.rejects(createCharge(input),/Não foi possível/);
  }finally{globalThis.fetch=original;}
});

test('API bloqueia cobranças sem chave e simulação em Vercel',async()=>{
  delete process.env.ATLAS_SECRET_KEY;process.env.LOCAL_REVIEW='1';process.env.VERCEL='1';process.env.VERCEL_ENV='production';assert.equal(reviewMode(),false);
  const server=createServer(handler).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  try{
    const response=await fetch(base+'/api/config');assert.equal((await response.json()).available,false);
    const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('/api/checkout',input)).status,503);
    assert.equal((await post('/api/review/pay',{})).status,404);
    assert.equal((await fetch(base+'/api/intro')).status,401);
    assert.equal((await fetch(base+'/api/review-thanks')).status,404);
    assert.equal((await fetch(base+'/api/review-pdf')).status,404);
    assert.equal((await fetch(base+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://wrong.test'},body:JSON.stringify(input)})).status,403);
  }finally{server.close();delete process.env.VERCEL;delete process.env.VERCEL_ENV;delete process.env.LOCAL_REVIEW;}
});

test('fluxo local completo: pendente, pago e PDF protegido',async()=>{
  process.env.LOCAL_REVIEW='1';const server=createServer(handler).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    const created=await (await post('/api/checkout',input)).json();assert.equal(created.status,'pending');
    const visual=await fetch(base+'/api/review-thanks');assert.equal(visual.status,200);assert.match(await visual.text(),/review-thanks.js/);
    const duplicate=await (await post('/api/checkout',input)).json();assert.equal(created.id,duplicate.id);
    assert.equal((await fetch(base+'/api/intro',{headers:{Authorization:'Bearer '+created.token}})).status,403);
    assert.equal((await post('/api/review/pay',{token:created.token})).status,200);
    const paid=await (await post('/api/order',{token:created.token})).json();assert.equal(paid.status,'paid');
    const pdf=await fetch(base+'/api/intro',{headers:{Authorization:'Bearer '+created.token}});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  }finally{server.close();delete process.env.LOCAL_REVIEW;}
});
