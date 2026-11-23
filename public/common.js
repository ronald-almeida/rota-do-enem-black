export const $ = id => document.getElementById(id);
export const ORDER_KEY = 'rota.order.v1';
export async function api(path, body) {
  const response = await fetch(path, { method:body ? 'POST' : 'GET', headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined, cache:'no-store', signal:AbortSignal.timeout(27000) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Não foi possível obter a resposta. Tente novamente.'); }
  if (!response.ok) throw new Error(data.error || 'Não foi possível continuar. Tente novamente.');
  return data;
}
export function readOrder() { try { return JSON.parse(sessionStorage.getItem(ORDER_KEY)); } catch { return null; } }
export function saveOrder(order) { sessionStorage.setItem(ORDER_KEY,JSON.stringify(order)); }
export function errorMessage(error) { return error.name === 'TimeoutError' || error.name === 'TypeError' ? 'A conexão não respondeu. Tente novamente com os mesmos dados ou fale com a equipe.' : error.message; }
export function showReview(config) {
  if (!config.review) return;
  const banner = document.createElement('div'); banner.className='review-banner';banner.textContent='AMBIENTE DE REVISÃO · Compra simulada. Nenhum pagamento real é gerado.';document.body.prepend(banner);
}
