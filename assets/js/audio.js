/* 音：曲ファイルを使わず、Web Audio でその場で鳴らす（著作権なし）
   ブラウザは勝手に音を出せないので、必ずボタンを押してから。場面ごとに楽器の量が変わる。
   3D 照明は window.ZENITH_AUDIO.level() を見て、音に合わせて動く */
(() => {
  'use strict';

  const BPM = 126;
  const STEP = 60 / BPM / 4;            // 16分音符の長さ（秒）
  const LOOKAHEAD = 0.14;               // この先 0.14 秒分を予約しておく
  const CHORDS = [                      // Am → F → C → G（1小節ずつ）
    { root: 55.00, notes: [220.0, 261.6, 329.6] },
    { root: 43.65, notes: [174.6, 220.0, 261.6] },
    { root: 65.41, notes: [261.6, 329.6, 392.0] },
    { root: 49.00, notes: [196.0, 246.9, 293.7] }
  ];
  const BASS_PATTERN = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
  const MIX = {                         // 場面ごとの楽器の量（0〜1）
    open:      { kick: 0,   hat: 0,   bass: 0,   pad: 1,   riser: 0 },
    lineup:    { kick: 1,   hat: 1,   bass: 1,   pad: 0.6, riser: 0 },
    stages:    { kick: 1,   hat: 1,   bass: 1,   pad: 0.8, riser: 0 },
    timetable: { kick: 1,   hat: 1,   bass: 1,   pad: 0.5, riser: 0 },
    zenith:    { kick: 1,   hat: 1,   bass: 1,   pad: 1,   riser: 1 },
    tickets:   { kick: 0.5, hat: 0,   bass: 0.6, pad: 1,   riser: 0 },
    dawn:      { kick: 0,   hat: 0,   bass: 0,   pad: 1,   riser: 0 }
  };

  let context = null;
  let master = null;
  let analyser = null;
  let buses = null;
  let noiseBuffer = null;
  let timer = null;
  let nextStepTime = 0;
  let step = 0;
  let running = false;
  let scene = document.body.dataset.scene || 'open';
  const kickTimes = [];
  const analyserData = new Uint8Array(256);

  const soundButton = document.getElementById('sound');
  const soundState = document.getElementById('sound-state');
  const startButtons = document.querySelectorAll('[data-sound-start]');

  const makeNoise = () => {
    const seconds = 1;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const setup = () => {
    context = new (window.AudioContext || window.webkitAudioContext)();
    master = context.createGain();
    master.gain.value = 0.5;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    master.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(context.destination);

    buses = {};
    ['kick', 'hat', 'bass', 'pad', 'riser'].forEach((name) => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      buses[name] = gain;
    });
    noiseBuffer = makeNoise();
    applyMix(scene, 0.01);
  };

  const applyMix = (name, ramp = 1.5) => {
    if (!buses) return;
    const mix = MIX[name] || MIX.open;
    Object.keys(mix).forEach((key) => {
      buses[key].gain.setTargetAtTime(mix[key], context.currentTime, ramp / 3);
    });
  };

  /* ---- 楽器 ---- */
  const kick = (time) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain);
    gain.connect(buses.kick);
    osc.start(time);
    osc.stop(time + 0.3);
    kickTimes.push(time);
    if (kickTimes.length > 8) kickTimes.shift();
  };

  const hat = (time, openHat) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const length = openHat ? 0.18 : 0.05;
    gain.gain.setValueAtTime(openHat ? 0.25 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(buses.hat);
    source.start(time);
    source.stop(time + length + 0.02);
  };

  const clap = (time) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(buses.riser);
    source.start(time);
    source.stop(time + 0.2);
  };

  const bass = (time, frequency) => {
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(220, time + 0.18);
    filter.Q.value = 6;
    gain.gain.setValueAtTime(0.28, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(buses.bass);
    osc.start(time);
    osc.stop(time + 0.22);
  };

  const pad = (time, notes, length) => {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.connect(buses.pad);
    notes.forEach((frequency, i) => {
      [-4, 4].forEach((detune) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = i === 0 ? 'triangle' : 'sawtooth';
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.07, time + 0.7);
        gain.gain.setValueAtTime(0.07, time + length - 0.6);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(time);
        osc.stop(time + length + 0.05);
      });
    });
  };

  const riser = (time, length) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    source.loop = true;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(5000, time + length);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.18, time + length);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length + 0.1);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(buses.riser);
    source.start(time);
    source.stop(time + length + 0.15);
  };

  /* ---- 予約係：少し先の音を順に予約していく ---- */
  const schedule = () => {
    while (nextStepTime < context.currentTime + LOOKAHEAD) {
      const bar = Math.floor(step / 16) % 4;
      const inBar = step % 16;
      const chord = CHORDS[bar];
      if (inBar % 4 === 0) kick(nextStepTime);
      if (inBar % 2 === 1) hat(nextStepTime, inBar === 15);
      if (BASS_PATTERN[inBar]) bass(nextStepTime, chord.root * (inBar === 13 ? 2 : 1));
      if (inBar === 0) pad(nextStepTime, chord.notes, STEP * 16);
      if (inBar === 4 || inBar === 12) clap(nextStepTime);
      if (inBar === 0 && bar === 0) riser(nextStepTime, STEP * 64);
      nextStepTime += STEP;
      step += 1;
    }
  };

  const start = () => {
    if (!context) setup();
    context.resume();
    if (!running) {
      running = true;
      nextStepTime = context.currentTime + 0.05;
      step = 0;
      timer = setInterval(schedule, 25);
    }
    master.gain.setTargetAtTime(0.5, context.currentTime, 0.2);
    soundButton.setAttribute('aria-pressed', 'true');
    soundState.textContent = 'ON';
  };

  const stop = () => {
    if (!context) return;
    master.gain.setTargetAtTime(0, context.currentTime, 0.15);
    clearInterval(timer);
    running = false;
    setTimeout(() => { if (!running && context) context.suspend(); }, 600);
    soundButton.setAttribute('aria-pressed', 'false');
    soundState.textContent = 'OFF';
  };

  const isOn = () => running;

  /* 今の音の大きさ（0〜1）。キックの瞬間は 1 に跳ねる */
  const level = () => {
    if (!running || !context) return 0;
    analyser.getByteTimeDomainData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / analyserData.length) * 3;
    let pulse = 0;
    const now = context.currentTime;
    for (let i = kickTimes.length - 1; i >= 0; i--) {
      if (kickTimes[i] <= now) { pulse = Math.exp(-(now - kickTimes[i]) * 9); break; }
    }
    return Math.min(1, Math.max(rms, pulse * (MIX[scene] || MIX.open).kick));
  };

  /* 拍の位置（0〜1）。音が無い時も、照明は同じテンポで静かに動く */
  const beatPhase = () => {
    const seconds = running && context ? context.currentTime : performance.now() / 1000;
    return (seconds / (STEP * 4)) % 1;
  };

  soundButton.addEventListener('click', () => (running ? stop() : start()));
  startButtons.forEach((button) => button.addEventListener('click', () => {
    if (!running) start();
    const target = document.getElementById('lineup');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  document.addEventListener('zenith:scene', (event) => {
    scene = event.detail.scene;
    applyMix(scene);
  });

  window.ZENITH_AUDIO = { start, stop, isOn, level, beatPhase };
})();
