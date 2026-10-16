// Technical audio render checks; these do not evaluate subjective sound quality.
// node tools/audio-validate.cjs [playwright module path] [optional report.json]
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname === '/audio-validation.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline audio validation</title>' });
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return route.abort();
      try { await route.fulfill({ body: await fs.readFile(file), contentType: path.extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:8096/audio-validation.html');
    const report = await page.evaluate(async () => {
      const { SoundEngine } = await import('/js/audio.js');
      const { TUNING, DEFAULT_TUNING } = await import('/js/config.js');
      const AudioContextConstructor = window.AudioContext;
      const scenarios = [];
      let seed = 0x1a2b3c4d;
      const random = Math.random;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const db = value => value > 0 ? 20 * Math.log10(value) : null;
      const measure = buffer => {
        let peak = 0, sumSquares = 0, sum = 0, nonFinite = 0, overFullScale = 0, audible = 0;
        const windows = [];
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let start = 0; start < samples.length; start += 2400) {
            let energy = 0;
            const end = Math.min(samples.length, start + 2400);
            for (let i = start; i < end; i++) {
              const value = samples[i];
              if (!Number.isFinite(value)) { nonFinite++; continue; }
              peak = Math.max(peak, Math.abs(value));
              sumSquares += value * value;
              energy += value * value;
              sum += value;
              if (Math.abs(value) > 1) overFullScale++;
              if (Math.abs(value) > 0.00001) audible++;
            }
            const rms = Math.sqrt(energy / (end - start));
            if (rms > 0.00001) windows.push(rms);
          }
        }
        const count = buffer.length * buffer.numberOfChannels;
        const rms = Math.sqrt(sumSquares / count);
        windows.sort((a, b) => a - b);
        const low = windows[Math.floor(windows.length * 0.1)] || 0;
        const high = windows[Math.min(windows.length - 1, Math.floor(windows.length * 0.95))] || 0;
        return { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, durationSeconds: buffer.duration, samples: count, nonFiniteSamples: nonFinite, peak, peakDbFS: db(peak), rms, rmsDbFS: db(rms), crestFactorDb: db(peak / rms), activeWindowRangeDb: low > 0 ? db(high / low) : null, dcOffset: sum / count, overFullScaleSamples: overFullScale, overFullScaleFraction: overFullScale / count, nonSilentFraction: audible / count };
      };
      const create = (seconds, boosted = false) => {
        Object.assign(TUNING, DEFAULT_TUNING);
        if (boosted) Object.assign(TUNING, { musicVolume: 3, sfxVolume: 2 });
        const offline = new OfflineAudioContext(2, Math.ceil(48000 * seconds), 48000);
        window.AudioContext = function () { return offline; };
        localStorage.setItem('vectra_master_vol', boosted ? '200' : '100');
        const engine = new SoundEngine();
        engine.init();
        clearInterval(engine.schedulerId);
        engine.schedulerId = null;
        engine.setMusicState({ intensity: 1 });
        return { engine, offline };
      };
      const music = engine => {
        const stepDuration = 60 / engine.bpm / 4;
        for (let step = 0; step < 64; step++) engine.triggerStep(step, 0.05 + step * stepDuration, stepDuration);
      };
      const effects = (engine, explosions) => {
        engine.lastShotSound = -Infinity;
        engine.playLaser();
        engine.playDash();
        engine.playLevelUp();
        engine.playSupernova();
        for (let i = 0; i < 8; i++) engine.playGeomPickup(i % 2 === 0);
        for (let i = 0; i < explosions; i++) engine.playExplosion(1.5);
      };
      try {
        for (const spec of [
          { name: 'default_music', explosions: 0, boosted: false },
          { name: 'muffled_menu_music', explosions: 0, boosted: false, muffled: true },
          { name: 'muted_music_and_all_sfx', explosions: 1, boosted: false, muted: true },
          { name: 'default_music_and_all_sfx', explosions: 1, boosted: false },
          { name: 'default_simultaneous_32_splitter_explosions', explosions: 32, boosted: false },
          { name: 'maximum_allowed_gains_with_all_sfx', explosions: 1, boosted: true },
          { name: 'maximum_allowed_gains_with_32_splitter_explosions', explosions: 32, boosted: true }
        ]) {
          const { engine, offline } = create(8.5, spec.boosted);
          if (spec.muffled) engine.setMusicState({ intensity: 1, muffled: true });
          if (spec.muted) engine.toggle();
          music(engine);
          if (spec.explosions) effects(engine, spec.explosions);
          engine.stopMusic();
          const buffer = await offline.startRendering();
          scenarios.push({ name: spec.name, expectedSilent: !!spec.muted, masterVolumePercent: engine.masterVolumePct, musicGain: TUNING.musicVolume, sfxGain: TUNING.sfxVolume, ...measure(buffer) });
        }
        const { engine, offline } = create(3);
        const scheduled = [];
        const originalTrigger = engine.triggerStep.bind(engine);
        engine.triggerStep = (step, time, duration) => { scheduled.push({ step, time }); originalTrigger(step, time, duration); };
        const suspended = offline.suspend(1);
        const rendering = offline.startRendering();
        await suspended;
        const recoveryTime = offline.currentTime;
        engine.nextNoteTime = 0.05;
        engine.scheduleMusic();
        await offline.resume();
        const buffer = await rendering;
        engine.stopMusic();
        scenarios.push({ name: 'real_audio_clock_recovery_after_one_second_gap', recoveryTime, scheduledSteps: scheduled, boundedRecovery: scheduled.length <= 2 && scheduled.every(step => step.time >= recoveryTime && step.time < recoveryTime + 0.1), ...measure(buffer) });
        return { technicalValidationOnly: true, subjectiveListeningPerformed: false, deterministicNoiseSeed: '0x1a2b3c4d', userAgent: navigator.userAgent, scenarios };
      } finally {
        window.AudioContext = AudioContextConstructor;
        Math.random = random;
        Object.assign(TUNING, DEFAULT_TUNING);
      }
    });
    report.browserVersion = browser.version();
    report.pageErrors = pageErrors;
    report.failures = [];
    for (const result of report.scenarios) {
      if (result.nonFiniteSamples) report.failures.push(result.name + ': non-finite output samples');
      if (result.expectedSilent ? result.peak > 0.00001 : !(result.rms > 0.00001)) report.failures.push(result.name + (result.expectedSilent ? ': mute leaked audio' : ': unexpected silent render'));
      if (result.overFullScaleSamples) report.failures.push(result.name + ': output exceeds digital full scale');
      if (result.boundedRecovery === false) report.failures.push(result.name + ': unbounded or overdue scheduling');
    }
    report.failures.push(...pageErrors.map(error => 'page error: ' + error));
    report.pass = report.failures.length === 0;
    const json = JSON.stringify(report, null, 2);
    if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), json + '\n');
    console.log(json);
    if (!report.pass) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
