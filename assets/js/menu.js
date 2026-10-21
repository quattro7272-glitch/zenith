/* スマホ・タブレットの目次（TIME ボタン）：開く・閉じる・Escape・リンクを押したら閉じる */
(() => {
  'use strict';

  const button = document.getElementById('menu-btn');
  const menu = document.getElementById('menu');
  const closeButton = document.getElementById('menu-close');
  if (!button || !menu || !closeButton) return;

  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const current = menu.querySelector('.menu__link.is-current') || menu.querySelector('.menu__link');
    if (current) current.focus();
  };

  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  closeButton.addEventListener('click', close);
  menu.addEventListener('click', (event) => {
    if (event.target.closest('.menu__link')) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) close();
  });
})();
