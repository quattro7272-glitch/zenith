/* 現在地の時計：スクロールの位置を「一夜の時刻」に変えて、ヘッダー・右端の目盛り・URL に反映する
   18:00 を 0 分として、各場面の data-time（分）の間を、場面の中の進み具合で補間する */
(() => {
  'use strict';

  const scenes = Array.from(document.querySelectorAll('.scene[data-scene]'));
  if (!scenes.length) return;

  const clockTime = document.getElementById('clock-time');
  const clockScene = document.getElementById('clock-scene');
  const clockCount = document.getElementById('clock-count');
  const headerBar = document.getElementById('header-bar');
  const railMarker = document.getElementById('rail-marker');
  const currentLinks = Array.from(document.querySelectorAll('.rail__tick, .menu__link'));
  const root = document.documentElement;

  const NIGHT_END = 690;   // 05:30 = 18:00 の 690 分後
  const PALETTE = {
    open:      { accent: '#7b3fe4', accent2: '#22e3ff', bg: '#07060f' },
    lineup:    { accent: '#22e3ff', accent2: '#9d6bff', bg: '#050a14' },
    stages:    { accent: '#ff2fa0', accent2: '#22e3ff', bg: '#0a0614' },
    timetable: { accent: '#ff2fa0', accent2: '#ffd1e8', bg: '#0d0510' },
    zenith:    { accent: '#ffffff', accent2: '#22e3ff', bg: '#000000' },
    tickets:   { accent: '#7b3fe4', accent2: '#c9b8ff', bg: '#06040c' },
    dawn:      { accent: '#ffb347', accent2: '#ffd9a8', bg: '#1b1530' }
  };

  let currentScene = null;
  let ticking = false;

  /* URL に #zenith などが付いて開かれた時は、その場面へ飛ぶまで URL を書き換えない
     （先に #open で上書きすると、ブラウザが元の場所へ飛べなくなる） */
  let initialTarget = null;
  try {
    if (window.location.hash.length > 1) initialTarget = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  } catch (error) { initialTarget = null; }
  let allowHash = !initialTarget;

  const pad = (n) => String(n).padStart(2, '0');
  const formatTime = (minutes) => {
    const total = (18 * 60 + Math.round(minutes)) % (24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  const sceneTop = (section) => section.getBoundingClientRect().top + window.scrollY;

  const update = () => {
    ticking = false;
    const viewport = window.innerHeight;
    const reference = window.scrollY + viewport * 0.4;

    let index = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (sceneTop(scenes[i]) <= reference) index = i;
    }
    const section = scenes[index];
    const start = Number(section.dataset.time);
    const top = sceneTop(section);
    const next = scenes[index + 1];
    const end = next ? Number(next.dataset.time) : NIGHT_END;
    const bottom = next ? sceneTop(next) : top + section.offsetHeight;
    // 場面の先頭が画面の上端に来るまでは、その場面の時刻のまま（先頭で 18:00 と出るように）
    const progress = Math.min(1, Math.max(0, (window.scrollY - top) / Math.max(1, bottom - top)));
    const minutes = start + (end - start) * progress;

    clockTime.textContent = formatTime(minutes);
    clockTime.setAttribute('datetime', formatTime(minutes));
    clockScene.textContent = section.dataset.label;
    clockCount.textContent = `${pad(index + 1)} / ${pad(scenes.length)}`;

    const pageLength = Math.max(1, document.documentElement.scrollHeight - viewport);
    headerBar.style.width = `${Math.min(100, (window.scrollY / pageLength) * 100)}%`;
    if (railMarker) railMarker.style.top = `${(minutes / NIGHT_END) * 100}%`;

    const scene = section.dataset.scene;
    if (scene !== currentScene) {
      currentScene = scene;
      document.body.dataset.scene = scene;
      const colors = PALETTE[scene] || PALETTE.open;
      root.style.setProperty('--accent', colors.accent);
      root.style.setProperty('--accent-2', colors.accent2);
      root.style.setProperty('--bg', colors.bg);
      currentLinks.forEach((link) => link.classList.toggle('is-current', link.dataset.scene === scene));
      const hash = `#${section.id}`;
      if (allowHash && window.location.hash !== hash) history.replaceState(null, '', hash);
      document.dispatchEvent(new CustomEvent('zenith:scene', { detail: { scene, minutes } }));
    }
    document.dispatchEvent(new CustomEvent('zenith:tick', { detail: { scene, minutes, progress: window.scrollY / pageLength } }));
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  window.addEventListener('load', () => {
    if (initialTarget) initialTarget.scrollIntoView({ block: 'start' });
    allowHash = true;
    currentScene = null;   // 飛んだ先の場面を、もう一度ちゃんと反映する
    requestUpdate();
  });
  update();

  /* 文字や写真が、見えた時に現れる */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    reveals.forEach((el) => observer.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }
})();
