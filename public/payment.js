import { $, api, readOrder, saveOrder, errorMessage, showReview } from './common.js';
let order=readOrder(),timer,polling=false,stopped=false,failures=0;
const terminal={expired:['Este Pix expirou.','O prazo para pagar este código terminou. Se você já pagou, fale com a equipe e envie o comprovante. Caso contrário, volte ao checkout para gerar um novo Pix.'],failed:['Não foi possível concluir este Pix.','Volte ao checkout para tentar novamente ou fale com a equipe.'],refunded:['Este pagamento foi reembolsado.','Para dúvidas sobre sua solicitação, entre em contato com a equipe.'],chargeback:['Este pagamento está em análise.','Fale com a equipe para acompanhar seu pedido.']};
function status(title,message){$('loading').hidden=true;$('pix-view').hidden=true;$('status-view').hidden=false;$('status-title').textContent=title;$('status-message').textContent=message;}
function countdown(){
  if(!order?.pix)return;
  const left=Math.max(0,Math.ceil((Date.parse(order.pix.expiresAt)-Date.now())/1000));
  $('countdown').textContent=left?`Código válido por ${Math.floor(left/60).toString().padStart(2,'0')}:${(left%60).toString().padStart(2,'0')}`:'Prazo do código encerrado. Conferindo o pagamento…';
  $('copy').disabled=left===0;
}
function render(next){
  order={...order,...next};saveOrder(order);$('loading').hidden=true;
  if(order.status==='paid'){stopped=true;location.replace('/obrigado');return;}
  if(terminal[order.status]){stopped=true;sessionStorage.removeItem('rota.attempt.v1');status(...terminal[order.status]);return;}
  if(!order.pix){status('Não foi possível carregar o Pix.','Fale com a equipe para consultar sua compra.');return;}
  $('pix-view').hidden=false;$('status-view').hidden=true;$('pix-code').value=order.pix.code;
  $('order-reference').textContent='Pedido: '+order.order;
  if(order.pix.image){$('qr').src=order.pix.image;$('qr').hidden=false;$('qr-fallback').hidden=true;}else{$('qr-fallback').textContent=order.review?'SIMULAÇÃO · Este código não pode ser pago.':'Use o código Pix Copia e Cola abaixo.';}
  $('simulate').hidden=!order.review;countdown();
}
async function poll(){
  if(stopped||polling)return;
  if(document.hidden){timer=setTimeout(poll,8000);return;}
  polling=true;
  try{const next=await api('/api/order',{token:order.token});failures=0;$('poll-message').hidden=true;render(next);}catch(error){failures++;if(!order.pix)status('Não foi possível consultar agora.',errorMessage(error));else{$('poll-message').textContent='A conexão oscilou. Estamos tentando confirmar automaticamente. Não pague novamente se já concluiu o Pix.';$('poll-message').hidden=false;}}
  finally{polling=false;if(!stopped)timer=setTimeout(poll,Math.min(5000+failures*3000,20000));}
}
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(order.pix.code);$('copy-feedback').textContent='Código copiado! Agora, abra o aplicativo do seu banco.';}catch{$('pix-code').focus();$('pix-code').select();$('copy-feedback').textContent='Selecione e copie o código acima.';}});
$('simulate').addEventListener('click',async()=>{$('simulate').disabled=true;try{await api('/api/review/pay',{token:order.token});clearTimeout(timer);await poll();}catch(error){$('poll-message').textContent=errorMessage(error);$('poll-message').hidden=false;$('simulate').disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(timer);poll();}});
addEventListener('pageshow',event=>{if(event.persisted){clearTimeout(timer);poll();}});
await api('/api/config').then(showReview).catch(()=>{});
if(!order?.token){stopped=true;status('Seu pedido não está nesta sessão.','Volte ao checkout para iniciar a compra. Se já pagou, fale com a equipe pelo WhatsApp e guarde seu comprovante.');}else{if(order.status==='pending'&&order.pix)render(order);await poll();setInterval(countdown,1000);}
