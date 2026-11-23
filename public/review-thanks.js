import { $, showReview } from './common.js';
showReview({review:true});
document.querySelector('.review-banner').textContent='PRÉVIA VISUAL DA PÁGINA DE OBRIGADO · Nenhuma compra foi confirmada nesta tela.';
document.querySelector('.welcome .eyebrow').textContent='EXEMPLO DE COMO A PÁGINA APARECE APÓS A APROVAÇÃO';
$('loading').hidden=true;$('success').hidden=false;
$('receipt-reference').textContent='Prévia para revisão · Os dados de uma compra real aparecerão aqui.';
$('download-pdf').addEventListener('click',()=>{location.assign('/api/review-pdf');});
