// Turns the design's animated SVGs into the frames the terminal shows. Run it after changing assets/animations:
//   node scripts/render-faces.mjs
// Chrome draws them, so what appears in the terminal is exactly what the design shows.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 276;
const HEIGHT = 240;
// The hood is drawn a quarter wider than the design.
const STRETCH = 1.25;
const WIDTH = Math.round((HEIGHT * VIEW_WIDTH * STRETCH) / VIEW_HEIGHT);
// The hood's own box is 40,22 to 160,188, and the moods set the size: listening and hello reach x = 1 and 199, celebrating's confetti y = -31.5.
// It sits a little left of centre, away from the input. Only listening needs the frame's left edge, so it stays put.
const LEFT_SHIFT = 13;
const viewBox = mood => `${mood === 'listening' ? 0 : LEFT_SHIFT} -33 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
const AT_ONCE = 4;
const WORDMARK_HEIGHT = 96;

// Seconds in each loop and frames per second. Every animation in a file is stretched a little to fit its loop, so the seam never shows.
const loops = {
  idle: [4, 8], hello: [3, 10], listening: [3, 8], thinking: [3, 8], searching: [1.6, 10], working: [2, 12], focused: [5, 6],
  happy: [0.9, 12], celebrating: [2.4, 12], love: [2.4, 10], wink: [2, 8], surprised: [2.4, 10], confused: [2.4, 8], sad: [4, 6],
  grumpy: [1.4, 12], error: [1.6, 12], dizzy: [1.2, 12], sleepy: [4.5, 6],
};

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'hobkin-frames-'));

const chrome = async page => {
  const profile = mkdtempSync(join(work, 'profile-'));
  const { stdout } = await run(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--virtual-time-budget=120000', '--dump-dom', `file://${page}`,
  ], { maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
  rmSync(profile, { recursive: true, force: true });
  const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(stdout);
  if (!match) throw Error(`No result from ${page}`);
  return JSON.parse(match[1]);
};

const frameScript = (seconds, count) => `
(async () => {
  const LOOP = ${seconds * 1000};
  const COUNT = ${count};
  const svg = document.querySelector('svg');
  const animations = svg.getAnimations({ subtree: true });
  for (const animation of animations) {
    animation.pause();
    const { duration, delay } = animation.effect.getTiming();
    const ratio = LOOP / Math.max(1, Math.round(LOOP / duration)) / duration;
    animation.effect.updateTiming({ duration: duration * ratio, delay: delay * ratio });
  }
  const canvas = document.createElement('canvas');
  canvas.width = ${WIDTH};
  canvas.height = ${HEIGHT};
  const context = canvas.getContext('2d');
  const frames = [];
  for (let frame = 0; frame < COUNT; frame++) {
    // One whole loop in, so an animation with a delay is already running at the seam.
    for (const animation of animations) animation.currentTime = LOOP + (frame / COUNT) * LOOP;
    const copy = svg.cloneNode(true);
    const sources = [svg, ...svg.querySelectorAll('*')];
    const copies = [copy, ...copy.querySelectorAll('*')];
    sources.forEach((element, index) => {
      if (!element.getAnimations().length) return;
      const style = getComputedStyle(element);
      copies[index].style.animation = 'none';
      copies[index].style.transform = style.transform;
      copies[index].style.opacity = style.opacity;
    });
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    await image.decode();
    context.clearRect(0, 0, ${WIDTH}, ${HEIGHT});
    context.drawImage(image, 0, 0, ${WIDTH}, ${HEIGHT});
    frames.push(canvas.toDataURL('image/png').split(',')[1]);
  }
  document.getElementById('result').textContent = JSON.stringify({ frames });
})();`;

async function renderMood(theme, file) {
  const mood = file.replace(/^\d+-|\.svg$/g, '');
  const [seconds, fps] = loops[mood];
  const source = readFileSync(join(root, 'assets/animations', theme, file), 'utf8')
    .replace(/<rect x="-28" y="-28" width="256" height="256"[^>]*><\/rect>/, '')
    .replace('viewBox="-28 -28 256 256"', `viewBox="${viewBox(mood)}" preserveAspectRatio="none"`)
    .replace('width="512" height="512"', `width="${WIDTH}" height="${HEIGHT}"`);
  const page = join(work, `${theme}-${mood}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body>${source}<pre id="result"></pre><script>${frameScript(seconds, Math.round(seconds * fps))}</script></body>`);
  const { frames } = await chrome(page);
  mkdirSync(join(root, 'assets/faces', theme), { recursive: true });
  writeFileSync(join(root, 'assets/faces', theme, `${mood}.json`), JSON.stringify({ seconds, frames }));
  return { theme, mood, frames: frames.length, bytes: frames.reduce((sum, frame) => sum + frame.length, 0) };
}

async function renderWordmark(theme, color) {
  const page = join(work, `${theme}-wordmark.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&display=swap" rel="stylesheet">
<body><pre id="result"></pre><script>
(async () => {
  await document.fonts.load('800 ${WORDMARK_HEIGHT}px Nunito', 'hobkin');
  const font = '800 ${WORDMARK_HEIGHT}px Nunito';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  context.letterSpacing = '-1px';
  const { width, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = context.measureText('hobkin');
  canvas.width = Math.ceil(width) + 4;
  canvas.height = Math.ceil(ascent + descent) + 4;
  context.font = font;
  context.letterSpacing = '-1px';
  context.fillStyle = '${color}';
  context.fillText('hobkin', 2, ascent + 2);
  document.getElementById('result').textContent = JSON.stringify({ width: canvas.width, height: canvas.height, frames: [canvas.toDataURL('image/png').split(',')[1]] });
})();</script></body>`);
  const wordmark = await chrome(page);
  writeFileSync(join(root, 'assets/faces', theme, 'wordmark.json'), JSON.stringify(wordmark));
  return { theme, mood: 'wordmark', frames: 1, bytes: wordmark.frames[0].length, size: `${wordmark.width}x${wordmark.height}` };
}

try {
  const jobs = ['dark', 'light'].flatMap(theme => readdirSync(join(root, 'assets/animations', theme))
    .filter(file => !file.startsWith('00-'))
    .map(file => () => renderMood(theme, file)));
  jobs.push(() => renderWordmark('dark', '#F0EAD6'), () => renderWordmark('light', '#16181F'));
  const results = [];
  const next = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await job());
  };
  await Promise.all(Array.from({ length: AT_ONCE }, next));
  const bytes = results.reduce((sum, { bytes: size }) => sum + size, 0);
  const frames = results.reduce((sum, { frames: count }) => sum + count, 0);
  console.log(`${results.length} files, ${frames} frames, ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(results.filter(result => result.size).map(result => `${result.theme} wordmark ${result.size}`).join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
