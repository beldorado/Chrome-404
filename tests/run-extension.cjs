// Loads the unpacked extension in Chromium, drives the side panel and checks the Perform view end to end.
// Usage: PW_CORE=<playwright-core> node tests/run-extension.cjs [screenshot-dir]
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!process.env.PW_CORE) {
  console.error('Set PW_CORE (path to a playwright-core package with Chromium installed).');
  process.exit(2);
}
const { chromium } = require(process.env.PW_CORE);

function drumWav(bpm, bars, rate = 48000) {
  const frames = Math.round((bars * 4 * 60 * rate) / bpm);
  const left = new Float32Array(frames);
  const beat = (60 * rate) / bpm;
  for (let b = 0; b < bars * 4; b++) {
    const at = Math.round(b * beat);
    for (let i = 0; i < rate * 0.25 && at + i < frames; i++) {
      const t = i / rate;
      left[at + i] += (b % 2 === 0 ? 0.8 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t) : 0.35 * (Math.random() * 2 - 1)) * Math.exp(-t * (b % 2 === 0 ? 9 : 22));
    }
  }
  const data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * 4, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, left[i])) * 32767);
    data.writeInt16LE(v, 44 + i * 4);
    data.writeInt16LE(v, 46 + i * 4);
  }
  return data;
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome404-'));
  const wav = path.join(profile, 'Boom loop.wav');
  fs.writeFileSync(wav, drumWav(100, 1));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 380, height: 1100 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--autoplay-policy=no-user-gesture-required']
  });
  const errors = [];
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
    await page.waitForFunction(() => document.querySelectorAll('.pad').length === 12 && document.querySelector('#bpm').value !== '');
    const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
    const engine = (type, payload = {}) => page.evaluate(([type, payload]) => chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload }), [type, payload]);

    check('Perform view is the default', await page.evaluate(() => document.body.dataset.view === 'perform' && !document.getElementById('perform').hidden && document.getElementById('edit').hidden));
    check('Six bus FX buttons and twelve pads render, keyed Q to V', (await page.locator('.fx').count()) === 6 && (await page.locator('.pad').count()) === 12 && (await page.$$eval('.pad .pad-key', (ks) => ks.map((k) => k.textContent).join(''))) === 'QWERASDFZXCV');
    await shot('01-empty');

    await page.selectOption('#preset', 'classic');
    await page.waitForFunction(() => document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit'));
    check('Loading the classic preset lights Bus 4 and Master', await page.evaluate(() => ['bus4', 'master'].every((b) => document.querySelector(`.fx[data-bus="${b}"]`).classList.contains('lit'))));

    await page.keyboard.press('Digit4');
    await page.waitForFunction(() => !document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit'));
    check('Tapping key 4 switches Bus 4 off', true);
    check('Tapping a bus selects it for the CTRL knobs', await page.evaluate(() => document.querySelector('.ctrl-bus').textContent === 'Bus 4' && document.querySelectorAll('.ctrl-knob').length === 3));
    check('Bus 4 chain shows chips for its three effects', (await page.locator('.chip').count()) === 3);

    await page.keyboard.down('Digit4');
    await page.waitForFunction(() => document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit'));
    await page.waitForTimeout(450);
    await page.keyboard.up('Digit4');
    await page.waitForFunction(() => !document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit'));
    check('Holding key 4 plays Bus 4 only while held', true);

    const fx1 = page.locator('.fx[data-bus="bus1"]');
    await fx1.click();
    check('Clicking an empty bus selects it and offers an effect picker', await page.evaluate(() => document.querySelector('.ctrl-bus').textContent === 'Bus 1' && document.querySelector('.ctrl-effect').value === ''));
    await page.selectOption('.ctrl-effect', 'filter-drive');
    await page.waitForFunction(() => document.querySelectorAll('.ctrl-knob').length === 3);
    check('Choosing an effect adds it and shows Cutoff, Reso, Drive', (await page.locator('.ctrl-knob label').allTextContents()).join() === 'Cutoff,Reso,Drive');

    const knob = page.locator('.ctrl-knob').first();
    const box = await knob.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 6 });
    await page.mouse.up();
    const state = await engine('get-state');
    const cutoff = state.result.buses.bus1.slots[0].params.cutoff;
    check('Dragging CTRL 1 up raises the cutoff', cutoff > 1200, `${Math.round(cutoff)} Hz`);
    check('The screen shows the last touched control', /Cutoff/.test(await page.textContent('#readout-name')), await page.textContent('#readout'));

    await page.selectOption('.ctrl-effect', 'lofi');
    await page.waitForFunction(() => document.querySelector('.ctrl-knob label')?.textContent === 'Rate');
    await page.selectOption('.ctrl-effect', 'filter-drive');
    await page.waitForFunction(() => document.querySelector('.ctrl-knob label')?.textContent === 'Cutoff');
    const recalled = (await engine('get-state')).result.buses.bus1.slots[0].params.cutoff;
    check('Swapping away and back keeps the cutoff (effect memory)', Math.abs(recalled - cutoff) < 1e-6, `${Math.round(recalled)} Hz`);

    await page.click('#quantize');
    await page.waitForFunction(() => document.querySelector('#quantize').textContent === 'Q 1/8');
    check('Quantize key cycles 1/16 → 1/8', true);

    await page.locator('.pad').nth(2).click();
    await page.setInputFiles('.bank input[type="file"]', wav);
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].classList.contains('loaded'));
    check('Loading a WAV fills the selected pad with its name and waveform', await page.evaluate(() => {
      const pad = document.querySelectorAll('.pad')[2];
      return pad.querySelector('.pad-name').textContent === 'Boom loop' && pad.querySelector('path').getAttribute('d').length > 100;
    }));
    check('Imported samples cannot follow BPM (no tempo known)', await page.evaluate(() => document.querySelector('.pad-options input[type="checkbox"]').disabled));

    await page.fill('[data-role="pad-bpm"]', '135');
    await page.press('[data-role="pad-bpm"]', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.pad-options input[type="checkbox"]').disabled);
    check('Typing a BPM on the pad turns Follow BPM on', await page.evaluate(() => document.querySelector('.pad-options input[type="checkbox"]').checked && document.querySelector('[data-role="pad-bpm"]').value === '135'));
    await shot('03-pad-bpm');
    await page.fill('[data-role="pad-bpm"]', '');
    await page.press('[data-role="pad-bpm"]', 'Enter');
    await page.waitForFunction(() => document.querySelector('.pad-options input[type="checkbox"]').disabled);
    check('Clearing the pad BPM disables Follow BPM again', true);

    await page.selectOption('[data-role="pad-choke"]', '2');
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].querySelector('.pad-group').textContent === 'G2');
    check('Picking a choke group tags the pad', (await engine('get-state')).result.pads[2].choke === 2);
    await shot('03-pad-choke');
    await page.selectOption('[data-role="pad-choke"]', '0');
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].querySelector('.pad-group').textContent === '');

    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].classList.contains('playing'));
    check('Key E starts pad 3 looping', true);
    await page.waitForFunction(() => document.querySelector('#position').textContent !== '–.–', null, { timeout: 4000 });
    check('Beat clock runs while a pad plays', /^\d+\.\d$/.test(await page.textContent('#position')), await page.textContent('#position'));

    await page.keyboard.press('KeyT');
    await page.waitForFunction(() => document.querySelector('.rec').classList.contains('armed') || document.querySelector('.rec').classList.contains('recording'));
    check('T arms a recording into the first empty pad', await page.evaluate(() => document.querySelectorAll('.pad')[0].classList.contains('recording')));
    await shot('02-playing-recording');
    await page.waitForFunction(() => document.querySelectorAll('.pad')[0].classList.contains('loaded'), null, { timeout: 15000 });
    const pads = (await engine('get-state')).result.pads;
    check('One bar is resampled into pad 1 with its BPM, named after the time it was recorded', /^\d\d:\d\d:\d\d, [A-Z][a-z]{2} \d{1,2}$/.test(pads[0].clip?.name) && pads[0].clip.bpm === 90 && Math.abs(pads[0].clip.duration - (4 * 60) / 90) < 0.01, JSON.stringify(pads[0].clip?.name));

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.pad.playing'));
    check('Esc stops every pad', true);

    const download = page.waitForEvent('download');
    await page.locator('.pad').nth(0).click();
    await page.waitForTimeout(100);
    await page.click('.pad-tools >> text=Export WAV');
    const file = await download;
    const saved = path.join(profile, file.suggestedFilename());
    await file.saveAs(saved);
    const header = fs.readFileSync(saved).subarray(0, 12).toString('latin1');
    check('Export WAV downloads a valid WAV', header.startsWith('RIFF') && header.endsWith('WAVE'), file.suggestedFilename());

    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 2, null, { timeout: 5000 }).catch(() => {});
    check('Pads survive reopening the panel', (await page.locator('.pad.loaded').count()) === 2);

    const firstName = (await engine('get-state')).result.pads[0].clip.name;
    await page.click('.pad-tools >> text=Clear');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 1);
    check('Clear empties the pad in one click and offers Undo', await page.evaluate(() => !document.getElementById('status').hidden && /^Cleared A1/.test(document.getElementById('status-text').textContent) && !document.getElementById('status-action').hidden));
    await page.click('#status-action');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 2, null, { timeout: 5000 }).catch(() => {});
    const restored = (await engine('get-state')).result.pads[0];
    check('Undo brings the cleared pad back with its name and BPM', restored.clip?.name === firstName && restored.clip?.bpm === 90, restored.clip?.name);
    await page.click('.pad-tools >> text=Clear');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 1);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 2, null, { timeout: 5000 }).catch(() => {});
    check('Ctrl+Z undoes Clear too', (await page.locator('.pad.loaded').count()) === 2);
    await page.click('.pad-tools >> text=Clear');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 1);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 2, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+KeyZ');
    await page.waitForTimeout(200);
    check('A second Ctrl+Z has nothing left to undo', (await page.locator('.pad.loaded').count()) === 2 && /Nothing to undo/.test(await page.textContent('#readout')));
    await page.click('.pad-tools >> text=Clear');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 1);
    await page.waitForFunction(() => document.getElementById('status').hidden, null, { timeout: 12000 }).catch(() => {});
    check('The Undo message goes away on its own', await page.evaluate(() => document.getElementById('status').hidden));
    await shot('03-perform');

    await page.locator('.pad').nth(2).click();
    await page.keyboard.press('Escape');
    await page.click('.pad-tools >> text=Edit / chop');
    await page.waitForFunction(() => !document.querySelector('.editor').hidden && /Length/.test(document.querySelector('.editor-readout').textContent));
    check('Edit / chop opens the waveform editor for the pad', await page.evaluate(() => document.querySelector('.editor-title').textContent.includes('Editing A3') && document.querySelector('.pad-detail').hidden));
    await page.click('.editor >> text=Find hits');
    await page.waitForFunction(() => /slices/.test(document.querySelector('.editor-readout').textContent));
    check('Find hits chops the drum loop at its 3 later hits (4 slices)', /4 slices/.test(await page.textContent('.editor-readout')), await page.textContent('.editor-readout'));

    await page.click('.editor >> text=Play');
    await page.waitForTimeout(350);
    await page.keyboard.press('KeyG');
    await page.waitForFunction(() => /5 slices/.test(document.querySelector('.editor-readout').textContent), null, { timeout: 3000 }).catch(() => {});
    check('Tapping G while it plays drops a chop at the playhead', /5 slices/.test(await page.textContent('.editor-readout')), await page.textContent('.editor-readout'));
    await shot('06-editor');

    const view = () => page.$eval('.wave-graph', (c) => ({ zoom: Number(c.dataset.zoom), amp: Number(c.dataset.amp), overview: !document.querySelector('.wave-overview').hidden, thumb: document.querySelector('.wave-window').style.width, left: parseFloat(document.querySelector('.wave-window').style.left) }));
    const graph = await page.locator('.wave-graph').boundingBox();
    const [gx, gy] = [graph.x + graph.width * 0.6, graph.y + graph.height / 2];
    const slicesBefore = await page.textContent('.editor-readout');
    await page.mouse.move(gx, gy);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -600);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => Number(document.querySelector('.wave-graph').dataset.zoom) > 1.5);
    const zoomedIn = await view();
    check('Shift+scroll zooms in on the waveform and shows the overview bar', zoomedIn.zoom > 1.5 && zoomedIn.overview && parseFloat(zoomedIn.thumb) < 70, JSON.stringify(zoomedIn));
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, -500);
    await page.keyboard.up('Alt');
    await page.waitForFunction(() => Number(document.querySelector('.wave-graph').dataset.amp) > 1.5);
    check('Alt+scroll zooms the amplitude', (await view()).amp > 1.5, JSON.stringify(await view()));
    const beforeGrab = await view();
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(gx - 80, gy, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const afterGrab = await view();
    check('Holding the scroll wheel and dragging left moves later into the sample, keeping the zoom', afterGrab.left > beforeGrab.left + 5 && afterGrab.zoom === beforeGrab.zoom && (await page.textContent('.editor-readout')) === slicesBefore, `view starts at ${beforeGrab.left.toFixed(1)}% → ${afterGrab.left.toFixed(1)}%`);
    await page.mouse.move(gx, gy);
    await shot('06-editor-zoom');
    await page.keyboard.down('Shift');
    await page.mouse.dblclick(gx, gy);
    await page.keyboard.up('Shift');
    const timeReset = await view();
    check('Shift+double-click resets the time zoom and keeps the amplitude', timeReset.zoom === 1 && !timeReset.overview && timeReset.amp > 1.5 && (await page.textContent('.editor-readout')) === slicesBefore, JSON.stringify(timeReset));
    await page.keyboard.down('Alt');
    await page.mouse.dblclick(gx, gy);
    await page.keyboard.up('Alt');
    check('Alt+double-click resets the amplitude without adding a chop', (await view()).amp === 1 && (await page.textContent('.editor-readout')) === slicesBefore, await page.textContent('.editor-readout'));

    await page.click('.editor-send .key');
    await page.waitForFunction(() => document.querySelectorAll('.pad.loaded').length === 6, null, { timeout: 8000 });
    const sliced = (await engine('get-state')).result.pads;
    const slicePads = [3, 4, 5, 6, 7].map((i) => sliced[i]);
    check('Send slices fills pads A4–A8 with one-shots named after the source', slicePads.every((p, n) => p.clip?.name === `Boom loop ${n + 1}` && p.mode === 'One-shot'), slicePads.map((p) => `${p.clip?.name}/${p.mode}`).join(', '));
    const total = slicePads.reduce((sum, p) => sum + p.clip.duration, 0);
    check('Slices add up to the whole sample', Math.abs(total - sliced[2].clip.duration) < 0.002, `${total.toFixed(4)} s vs ${sliced[2].clip.duration.toFixed(4)} s`);

    const wave = await page.locator('.wave-graph').boundingBox();
    await page.mouse.move(wave.x + 2, wave.y + wave.height / 2);
    await page.mouse.down();
    await page.mouse.move(wave.x + wave.width * (0.45 / 2.4), wave.y + wave.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const trimmed = (await engine('get-state')).result.pads[2].clip;
    check('Dragging S trims the start without changing the audio', Math.abs(trimmed.start - 0.45) < 0.02 && trimmed.end === trimmed.duration, `start ${trimmed.start.toFixed(3)} s of ${trimmed.duration.toFixed(3)} s`);
    check('Trimming drops the chop that falls before the new start', /4 slices/.test(await page.textContent('.editor-readout')), await page.textContent('.editor-readout'));

    await page.click('.editor >> text=Truncate');
    await page.waitForFunction(() => /Start 0\.000/.test(document.querySelector('.editor-readout').textContent) && /4 slices/.test(document.querySelector('.editor-readout').textContent), null, { timeout: 5000 }).catch(() => {});
    const cutClip = (await engine('get-state')).result.pads[2].clip;
    check(
      'Truncate cuts the sample to S–E for good and keeps the chops',
      Math.abs(cutClip.duration - (trimmed.duration - trimmed.start)) < 0.002 && cutClip.start === 0 && cutClip.end === cutClip.duration && /4 slices/.test(await page.textContent('.editor-readout')) && (await page.evaluate(() => [...document.querySelectorAll('.editor-head .key')].find((b) => b.textContent === 'Truncate')?.disabled)),
      `${cutClip.duration.toFixed(3)} s, ${await page.textContent('.editor-readout')}`
    );
    await page.keyboard.press('Control+KeyZ');
    for (let i = 0; i < 40 && (await engine('get-state')).result.pads[2].clip.duration < trimmed.duration - 0.01; i++) await page.waitForTimeout(50);
    const uncut = (await engine('get-state')).result.pads[2].clip;
    check('Ctrl+Z undoes Truncate and keeps the trim', Math.abs(uncut.duration - trimmed.duration) < 0.002 && Math.abs(uncut.start - trimmed.start) < 0.002, `${uncut.duration.toFixed(3)} s from ${uncut.start.toFixed(3)} s`);
    await page.waitForFunction(() => /4 slices/.test(document.querySelector('.editor-readout').textContent) && !/Start 0\.000/.test(document.querySelector('.editor-readout').textContent), null, { timeout: 5000 }).catch(() => {});
    await page.click('.editor >> text=Truncate');
    await page.waitForFunction(() => /Start 0\.000/.test(document.querySelector('.editor-readout').textContent), null, { timeout: 5000 }).catch(() => {});

    await page.fill('.editor-title .name-field', 'Boom take');
    await page.press('.editor-title .name-field', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].querySelector('.pad-name').textContent === 'Boom take', null, { timeout: 3000 }).catch(() => {});
    const renamed = await page.evaluate(async () => {
      const { getClip } = await import('/shared/pad-store.js');
      for (let i = 0; i < 40; i++) {
        const { name } = await getClip(2);
        if (name === 'Boom take') return name;
        await new Promise((r) => setTimeout(r, 50));
      }
      return (await getClip(2)).name;
    });
    check('Renaming in the editor renames the pad and the stored sample, and keeps the editor open', renamed === 'Boom take' && (await page.textContent('.pads .pad:nth-child(3) .pad-name')) === 'Boom take' && /4 slices/.test(await page.textContent('.editor-readout')), `${renamed}, ${await page.textContent('.editor-readout')}`);

    const pitchKnob = page.locator('.editor-pitch .knob').nth(1);
    const speedKnob = page.locator('.editor-pitch .knob').nth(0);
    await pitchKnob.hover();
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
    const linked = (await engine('get-state')).result.pads[2];
    check('In Vinyl, turning Pitch up 2 st speeds the sample up to match', linked.stretch === 'Vinyl' && Math.abs(linked.speed - Math.pow(2, 2 / 12)) < 1e-6 && linked.pitch === 0 && (await page.textContent('.editor-pitch .knob:nth-child(1) .knob-readout')) === '112%', `${linked.speed.toFixed(4)}, ${await page.textContent('.editor-pitch .knob:nth-child(1) .knob-readout')}`);
    await shot('06-editor-vinyl');
    await page.click('.editor-pitch >> text=Stretch');
    await page.waitForFunction(() => document.querySelector('.editor-pitch').dataset.stretch === 'Stretch');
    await speedKnob.dblclick();
    await pitchKnob.hover();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);
    const split = (await engine('get-state')).result.pads[2];
    check('In Stretch, Speed and Pitch are set separately', split.stretch === 'Stretch' && split.speed === 1 && split.pitch === -1 && /^Plays [\d.]+ s long$/.test(await page.textContent('.pitch-plays')), `${split.speed} / ${split.pitch} st, ${await page.textContent('.pitch-plays')}`);
    await shot('06-editor-pitch');

    await page.click('.editor >> text=Done');
    await page.fill('.pad-title .name-field', 'Boom final');
    await page.locator('.pad-title .name-field').blur();
    await page.waitForFunction(() => document.querySelectorAll('.pad')[2].querySelector('.pad-name').textContent === 'Boom final', null, { timeout: 3000 }).catch(() => {});
    check('The pad panel renames the pad too', (await engine('get-state')).result.pads[2].clip.name === 'Boom final');
    await page.fill('.pad-title .name-field', '');
    await page.press('.pad-title .name-field', 'Escape');
    check('Clearing the name and pressing Esc keeps the old name', (await page.inputValue('.pad-title .name-field')) === 'Boom final' && (await engine('get-state')).result.pads[2].clip.name === 'Boom final');
    check('Done closes the editor and brings back the pad details', await page.evaluate(() => document.querySelector('.editor').hidden && !document.querySelector('.pad-detail').hidden));

    const padStates = async (from, to) => (await engine('get-state')).result.pads.slice(from, to);
    const untilPads = async (test, ms = 5000) => {
      const start = Date.now();
      while (!test((await engine('get-state')).result.pads)) {
        if (Date.now() - start > ms) throw new Error('Timed out waiting for the pads to change');
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await page.locator('.pad').nth(3).click({ modifiers: ['Shift'] });
    await page.waitForFunction(() => document.querySelector('.pad-title strong').textContent === 'Pad A4');
    check('Shift+click selects a pad without playing it', (await padStates(3, 4))[0].playing === false && (await page.locator('.pad').nth(3).getAttribute('class')).includes('selected'));
    await page.locator('.pad').nth(4).click({ modifiers: ['Control'] });
    await page.locator('.pad').nth(5).click({ modifiers: ['Control'] });
    await page.waitForFunction(() => document.querySelector('.pad-title strong').textContent === '3 pads');
    check('Ctrl+click adds pads to the selection without playing them', (await padStates(3, 6)).every((p) => !p.playing) && (await page.locator('.bank.multi .pad.selected').count()) === 3, await page.textContent('.pad-chips'));
    await page.click('.pad-detail [data-mode="Gate"]');
    await page.selectOption('[data-role="pad-choke"]', '1');
    await page.fill('[data-role="pad-bpm"]', '120');
    await page.press('[data-role="pad-bpm"]', 'Enter');
    await page.waitForFunction(() => document.querySelector('.pad-options input[type="checkbox"]').checked);
    await page.$eval('[data-role="pad-level"]', (el) => {
      el.value = '0.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await untilPads((pads) => pads[5].level === 0.5);
    const edited = await padStates(3, 7);
    check(
      'Edits apply to every selected pad and no others',
      edited.slice(0, 3).every((p) => p.mode === 'Gate' && p.choke === 1 && p.clip.bpm === 120 && p.sync && p.level === 0.5) && edited[3].mode === 'One-shot' && edited[3].choke === 0 && edited[3].clip.bpm === null,
      JSON.stringify(edited.map((p) => [p.mode, p.choke, p.clip.bpm, p.level]))
    );
    await page.locator('.pad').nth(6).click({ modifiers: ['Control'] });
    await page.waitForFunction(() => document.querySelector('[data-role="pad-bpm"]').placeholder === 'Mixed');
    check('Mixed values show as mixed when the selection differs', await page.evaluate(() => document.querySelector('[data-role="pad-bpm"]').value === '' && document.querySelector('[data-role="pad-choke"]').value === '' && [...document.querySelectorAll('.pad-detail [data-mode]')].every((b) => b.getAttribute('aria-checked') === 'false')));
    await shot('03-multi-select');
    await page.click('.pad-chip >> text=A5');
    await page.waitForFunction(() => document.querySelector('.pad-title strong').textContent === '3 pads');
    check('Clicking a pad tag takes it out of the selection', (await page.textContent('.pad-chips')).replace(/×/g, '') === 'A4A6A7', await page.textContent('.pad-chips'));
    await page.locator('.pad').nth(3).click();
    await page.waitForFunction(() => document.querySelector('.pad-title strong').textContent === 'Pad A4');
    check('A plain click goes back to a single pad', (await page.locator('.bank.multi').count()) === 0 && (await page.locator('.pad.selected').count()) === 1);

    const dragPad = async (from, to, { quiet = true } = {}) => {
      const a = await page.locator('.pad').nth(from).boundingBox();
      const b = await page.locator('.pad').nth(to).boundingBox();
      if (quiet) await page.keyboard.down('Shift');
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
      await page.mouse.up();
      if (quiet) await page.keyboard.up('Shift');
      await page.waitForSelector('dialog.transfer[open]');
    };
    const choices = () => page.$$eval('dialog.transfer[open] .transfer-actions button', (bs) => bs.map((b) => b.textContent).join());
    const names = async () => (await padStates(0, 8)).map((p) => p.clip?.name ?? null);
    const empty = (await names()).indexOf(null);
    await dragPad(3, empty);
    check('Dropping a pad on an empty pad asks Move, Copy or Cancel', (await choices()) === 'Move,Copy,Cancel' && (await page.evaluate(() => document.activeElement.textContent === 'Move')), await choices());
    await page.click('dialog.transfer .transfer-actions >> text="Copy"');
    await untilPads((pads) => pads[empty].clip !== null);
    const copied = await padStates(0, 8);
    check('Copy fills the target with the sample and its settings and keeps the source', copied[empty].clip.name === 'Boom loop 1' && copied[empty].mode === 'Gate' && copied[empty].choke === 1 && copied[3].clip.name === 'Boom loop 1', `${copied[empty].clip.name}, ${copied[empty].mode}, group ${copied[empty].choke}`);

    await dragPad(4, 3);
    check('Dropping on a pad that holds a sample also offers Swap', (await choices()) === 'Move,Copy,Swap,Cancel', await choices());
    await page.waitForTimeout(200);
    await shot('08-drag-pad');
    await page.click('dialog.transfer .transfer-actions >> text="Swap"');
    await untilPads((pads) => pads[3].clip?.name === 'Boom loop 2');
    check('Swap trades the two pads', (await names())[4] === 'Boom loop 1', (await names()).slice(3, 5).join(' / '));

    await dragPad(empty, 7);
    await page.click('dialog.transfer .transfer-actions >> text="Move"');
    await untilPads((pads) => pads[empty].clip === null);
    const stored = await page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('chrome404');
      open.onsuccess = () => {
        const request = open.result.transaction('pads').objectStore('pads').getAll();
        request.onsuccess = () => resolve(request.result.map((r) => [r.index, r.name]));
      };
    }));
    check('Move replaces the target, empties the source and is saved', (await names())[7] === 'Boom loop 1' && !stored.some(([i]) => i === empty) && stored.some(([i, n]) => i === 7 && n === 'Boom loop 1'), JSON.stringify(stored));

    await dragPad(3, 4, { quiet: false });
    const playing = (await padStates(3, 4))[0].playing;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.transfer[open]'));
    check('A plain drag stops the pad it started, and Esc cancels the drop', playing === false && (await names()).slice(3, 5).join() === 'Boom loop 2,Boom loop 1', `playing ${playing}`);
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => document.querySelector('.pad .pad-num').textContent === 'B1');
    check('B switches to pad bank B', await page.evaluate(() => [...document.querySelectorAll('.bank-switch button')].map((b) => b.getAttribute('aria-checked')).join() === 'false,true'));
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => document.querySelector('.pad .pad-num').textContent === 'A1');

    await page.click('#view-edit');
    check('Edit view shows the chain editor and hides Perform', await page.evaluate(() => !document.getElementById('edit').hidden && document.getElementById('perform').hidden && document.querySelectorAll('.bus').length >= 3));
    check('Edit view has a bus on/off switch per bus', (await page.locator('.bus [data-role="engage"]').count()) >= 3);
    await page.click('#routing [data-routing="Series"]');
    await page.waitForFunction(() => document.querySelector('#routing [data-routing="Series"]').getAttribute('aria-checked') === 'true');
    check('Bus routing switches to series', (await engine('get-state')).result.busRouting === 'Series' && (await page.textContent('#routing-hint')).startsWith('Bus 1 → Bus 2'));
    await shot('04-edit');
    await page.click('#routing [data-routing="Parallel"]');
    await page.waitForFunction(() => document.querySelector('#routing [data-routing="Parallel"]').getAttribute('aria-checked') === 'true');
    await page.click('#view-perform');

    await page.selectOption('#preset', 'glitchKit');
    await page.waitForFunction(() => document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit') && document.querySelector('.fx[data-bus="bus1"] .fx-effect').textContent === 'DJ Looper');
    check('Glitch kit loads with buses 1–3 ready but dark', await page.evaluate(() => ['bus1', 'bus2', 'bus3'].every((b) => !document.querySelector(`.fx[data-bus="${b}"]`).classList.contains('lit'))));

    const fxShape = async () => {
      const { buses } = (await engine('get-state')).result;
      return JSON.stringify(Object.entries(buses).map(([id, b]) => [id, b.engaged, b.slots.map((s) => [s.effect, s.enabled, s.params])]));
    };
    const kitShape = await fxShape();
    await page.click('#save-preset');
    check('Save opens a name box with focus in it', await page.evaluate(() => !document.getElementById('preset-form').hidden && document.activeElement === document.querySelector('#preset-form input')));
    await page.keyboard.type('My kit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('preset-form').hidden && [...document.querySelectorAll('#preset optgroup[label="Saved"] option')].some((o) => o.textContent === 'My kit'));
    check('Saving adds the preset to the menu under Saved', true);
    await page.selectOption('#preset', 'init');
    await page.waitForFunction(() => !document.querySelector('.fx[data-bus="bus4"]').classList.contains('lit'));
    const mine = await page.evaluate(() => [...document.querySelectorAll('#preset option')].find((o) => o.textContent === 'My kit').value);
    await page.selectOption('#preset', mine);
    await page.waitForFunction(() => document.querySelector('.fx[data-bus="bus1"] .fx-effect').textContent === 'DJ Looper');
    check('Loading a saved preset brings back the whole FX setup', (await fxShape()) === kitShape);
    await page.click('#save-preset');
    await page.keyboard.type('my KIT');
    check('Typing an existing name offers to replace it', (await page.textContent('#preset-form button[type="submit"]')) === 'Replace');
    await shot('07-save-preset');
    await page.click('.preset-tag-delete');
    await page.click('.preset-tag-delete');
    await page.waitForFunction(() => !document.querySelector('#preset optgroup[label="Saved"]'));
    check('Deleting a preset takes two clicks and removes it', (await page.evaluate(() => chrome.storage.local.get('userPresets'))).userPresets.length === 0);
    await page.click('#preset-form >> text=Cancel');
    check('Cancel closes the name box', await page.evaluate(() => document.getElementById('preset-form').hidden));
    const fx2 = page.locator('.fx[data-bus="bus2"]');
    const b2 = await fx2.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('.fx[data-bus="bus2"]').classList.contains('lit'));
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.fx[data-bus="bus2"]').classList.contains('lit'));
    check('Holding the Bus 2 button with the mouse plays Stopper only while held', true);
    check('Clicking a bus button does not steal keyboard focus', await page.evaluate(() => !document.activeElement?.classList.contains('fx')));

    await page.locator('.pad').nth(5).click();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#readout-name').textContent === 'Tap');
    check('Space taps tempo even right after clicking a pad or tab', true, await page.textContent('#readout-value'));
    check('…and does not switch views or press the focused tab', await page.evaluate(() => document.body.dataset.view === 'perform'));
    await page.evaluate(() => window.addEventListener('keydown', (e) => (window.__spaceTaken = e.code === 'Space' && e.defaultPrevented)));
    await page.keyboard.press('Space');
    const mouseFocusTaken = await page.evaluate(() => window.__spaceTaken);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
    await page.keyboard.press('Space');
    const tabFocusTaken = await page.evaluate(() => window.__spaceTaken);
    await page.keyboard.press('Escape');
    check('Space is left to a control reached with Tab, but taken as tap after a mouse click', mouseFocusTaken === true && tabFocusTaken === false, `focused ${focused}; mouse-focus taken ${mouseFocusTaken}, tab-focus taken ${tabFocusTaken}`);

    await page.setViewportSize({ width: 320, height: 1100 });
    await shot('05-narrow');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('Nothing overflows horizontally at 320 px', !overflow);
  } catch (err) {
    check('Runner crashed', false, err.stack);
  } finally {
    const benign = errors.filter((e) => !/Receiving end does not exist/.test(e));
    check('No page errors', benign.length === 0, benign.join(' | '));
    await context.close();
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n== extension: ${results.length - failed}/${results.length}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
