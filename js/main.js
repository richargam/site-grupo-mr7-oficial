const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.main-nav');

menuButton?.addEventListener('click', () => {
  const isOpen = menu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

document.querySelectorAll('.main-nav a').forEach(link => {
  link.addEventListener('click', () => {
    menu.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

document.getElementById('year').textContent = new Date().getFullYear();

document.getElementById('brief-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('form-status');
  if (!form.checkValidity()) {
    form.reportValidity();
    status.textContent = 'Preencha os campos obrigatórios para continuar.';
    return;
  }
  const data = new FormData(form);
  const message = [
    'Olá, Grupo MR7! Quero iniciar um projeto.',
    '',
    `Nome: ${data.get('nome')}`,
    `WhatsApp/Telefone: ${data.get('telefone')}`,
    `E-mail: ${data.get('email')}`,
    `Serviço de interesse: ${data.get('servico')}`
  ].join('\n');
  status.textContent = 'Abrindo o WhatsApp...';
  window.open(`https://wa.me/5521967007447?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
});
