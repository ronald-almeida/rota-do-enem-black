import { $, api, saveOrder, errorMessage, showReview } from './common.js';
let available = false;
$('submit').disabled = true;
api('/api/config').then(config=>{
  available=config.available;showReview(config);$('submit').disabled=!available;
  if (!available) { $('availability').textContent='O pagamento está temporariamente indisponível. Tente novamente mais tarde.';$('availability').hidden=false; }
}).catch(()=>{ $('availability').textContent='Não foi possível carregar o pagamento. Recarregue a página e tente novamente.';$('availability').hidden=false; });
const digits = value => value.replace(/\D/g,'');
$('document').addEventListener('input',event=>{event.target.value=digits(event.target.value).slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');});
$('phone').addEventListener('input',event=>{const d=digits(event.target.value).slice(0,11);event.target.value=d.length>2 ? `(${d.slice(0,2)}) ${d.slice(2).replace(d.length>10?/(\d{5})(\d)/:/(\d{4})(\d)/,'$1-$2')}` : d;});
$('email-confirmation').addEventListener('input',()=>{$('email-confirmation').setCustomValidity('');});
$('checkout-form').addEventListener('submit',async event=>{
  event.preventDefault();if (!available || $('submit').disabled) return;
  $('form-error').hidden=true;
  if ($('email').value.trim().toLowerCase() !== $('email-confirmation').value.trim().toLowerCase()) { $('email-confirmation').setCustomValidity('Os e-mails precisam ser iguais.');$('email-confirmation').reportValidity();return; }
  const body={name:$('name').value.trim().replace(/\s+/g,' '),email:$('email').value.trim().toLowerCase(),emailConfirmation:$('email-confirmation').value.trim().toLowerCase(),document:digits($('document').value),phone:digits($('phone').value),accepted:event.target.elements.accepted.checked};
  $('submit').disabled=true;$('submit').textContent='Gerando seu Pix…';
  try {
    // Only a hash and a random attempt ID are retained; personal fields are not persisted.
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));
    const fingerprint=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
    let attempt;
    try { attempt=JSON.parse(sessionStorage.getItem('rota.attempt.v1')); } catch {}
    if (attempt?.fingerprint!==fingerprint) attempt={fingerprint,id:crypto.randomUUID()};
    sessionStorage.setItem('rota.attempt.v1',JSON.stringify(attempt));
    body.requestId=attempt.id;
    const order=await api('/api/checkout',body);
    saveOrder(order);location.assign(order.status==='paid'?'/obrigado':'/pagamento');
  } catch(error) { if(error.retryWithNewAttempt)sessionStorage.removeItem('rota.attempt.v1');$('form-error').textContent=errorMessage(error);$('form-error').hidden=false;$('form-error').scrollIntoView({behavior:'smooth',block:'center'});$('submit').disabled=false;$('submit').textContent='Gerar Pix de R$ 397,00'; }
});
