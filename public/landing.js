const backgrounds = new IntersectionObserver(entries => entries.forEach(entry => { if(entry.isIntersecting) { entry.target.classList.add('e-lazyloaded'); backgrounds.unobserve(entry.target); } }), {rootMargin:'400px'});
document.querySelectorAll('.e-con.e-parent').forEach(el=>backgrounds.observe(el));
document.querySelectorAll('.elementor-image-carousel-wrapper').forEach(el => {
  new Swiper(el, { slidesPerView:1.3, spaceBetween:14, loop:true, autoplay:matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { delay:4500, disableOnInteraction:true }, breakpoints:{600:{slidesPerView:2.3},1024:{slidesPerView:4}}, a11y:{enabled:true} });
});
document.querySelectorAll('.e-n-carousel').forEach(el => {
  const host = el.closest('.elementor-widget');
  new Swiper(el, { slidesPerView:1, spaceBetween:20, loop:false, navigation:{ nextEl:host.querySelector('.elementor-swiper-button-next'), prevEl:host.querySelector('.elementor-swiper-button-prev') }, pagination:{el:host.querySelector('.swiper-pagination'),clickable:true}, breakpoints:{768:{slidesPerView:2},1024:{slidesPerView:3}},a11y:{enabled:true,prevSlideMessage:'Slide anterior',nextSlideMessage:'Próximo slide',paginationBulletMessage:'Ir para o slide {{index}}'} });
});
const campaign = new URLSearchParams(location.search);
document.querySelectorAll('a[href="/checkout"]').forEach(a=>{const p=new URLSearchParams();for(const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])if(campaign.has(k))p.set(k,campaign.get(k));if(p.size)a.href='/checkout?'+p;});
fetch('/api/config').then(r=>r.json()).then(c=>{if(c.review){const b=document.createElement('div');b.className='review-banner';b.textContent='AMBIENTE DE REVISÃO · Pagamentos simulados, sem cobrança real.';document.body.prepend(b);}}).catch(()=>{});
