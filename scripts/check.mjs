import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
for (const dir of ['api','lib','public','scripts']) for (const name of await readdir(dir)) if (/\.(mjs|js)$/.test(name)) execFileSync(process.execPath, ['--check',join(dir,name)], { stdio:'inherit' });
for (const file of ['index.html','checkout.html','pagamento.html','obrigado.html','privacidade.html','termos.html']) {
  const html = await readFile('public/'+file, 'utf8');
  if (html.includes('pay.hotmart.com') || html.includes('1.970 ao vivo') || html.includes('�')) throw Error('Conteúdo antigo ou codificação inválida: '+file);
}
await readFile('private/introducao-rota-do-enem.pdf');
console.log('Build verificado: JavaScript, páginas e PDF disponíveis.');
