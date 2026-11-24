import { $, api, readOrder, saveOrder, errorMessage, showReview } from './common.js';
const order=readOrder();
await api('/api/config').then(showReview).catch(()=>{});
try{
  if(!order?.token)throw new Error('Não encontramos o pedido nesta sessão. Se você já pagou, entre em contato com a equipe pelo WhatsApp.');
  const verified=await api('/api/order',{token:order.token});
  Object.assign(order,verified);saveOrder(order);
  if(verified.status!=='paid'||verified.refunded>0)throw new Error(verified.status==='refunded'?'Este pagamento foi reembolsado. Fale com a equipe para obter mais informações.':'O pagamento ainda não foi confirmado ou precisa de atendimento. Volte à tela do Pix para acompanhar ou fale com a equipe.');
  $('success').hidden=false;$('receipt-reference').textContent='Pedido: '+verified.order;
  $('receipt-amount').textContent=Number(verified.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' no Pix';
  $('access-whatsapp').href='https://wa.me/5575988393742?text='+encodeURIComponent('Olá! Comprei o Rota do Enem (Black Vitalícia 2026) e estou com uma dúvida sobre o meu acesso. Meu pedido é '+verified.order+'.');
  $('download-pdf').addEventListener('click',async()=>{
    $('download-pdf').disabled=true;$('download-status').textContent='Preparando seu PDF…';
    try{
      const response=await fetch('/api/intro',{headers:{Authorization:'Bearer '+order.token},cache:'no-store',signal:AbortSignal.timeout(27000)});
      if(!response.ok)throw new Error('Não foi possível baixar agora. Tente novamente ou fale com a equipe.');
      const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='introducao-rota-do-enem.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('download-status').textContent='Download iniciado. Bons estudos!';
    }catch(error){$('download-status').textContent=errorMessage(error);}finally{$('download-pdf').disabled=false;}
  });
}catch(error){$('unverified').hidden=false;$('verification-message').textContent=errorMessage(error);}finally{$('loading').hidden=true;}
