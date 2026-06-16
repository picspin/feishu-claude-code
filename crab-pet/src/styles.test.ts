import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';

type DecodedPng = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

function decodeRgbaPng(path: URL): DecodedPng {
  const file = readFileSync(path);
  assert.equal(file.toString('ascii', 1, 4), 'PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
    }
    if (type === 'IDAT') {
      idatChunks.push(chunk);
    }
    if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  assert.equal(colorType, 6, `${path.pathname} must be an RGBA PNG with alpha`);
  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let targetOffset = 0;
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const current = new Uint8Array(raw.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? current[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 1) current[x] = (current[x] + left) & 0xff;
      if (filter === 2) current[x] = (current[x] + up) & 0xff;
      if (filter === 3) current[x] = (current[x] + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        current[x] = (current[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      }
    }

    pixels.set(current, targetOffset);
    targetOffset += stride;
    previous = current;
  }

  return { width, height, pixels };
}

function alphaAt(image: DecodedPng, x: number, y: number): number {
  return image.pixels[(y * image.width + x) * 4 + 3];
}

test('pet markup uses the transparent source sprite instead of CSS-drawn body parts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="crab-sprite"/);
  assert.doesNotMatch(html, /shell-spiral|crab-body|claw-left|bubble-a/);
});

test('state styles map the six reusable transparent crab forms', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  for (const asset of [
    'crab-neutral.png',
    'crab-sleep.png',
    'crab-wink.png',
    'crab-wave.png',
    'crab-shrink.png',
    'crab-bubble.png',
    'crab-crawl.png',
  ]) {
  assert.match(css, new RegExp(`/src/assets/${asset}`));
  }
  assert.match(css, /\.crab-shell\[data-state="sleep"\][^{]*\{[^}]*filter:[^}]*hue-rotate/s);
  assert.match(css, /\.crab-shell\[data-state="sleep"\][^{]*\{[^}]*--crab-art:\s*url\("\/src\/assets\/crab-sleep\.png"\)/s);
  assert.match(css, /\.crab-shell\[data-state="awake"\][^{]*\{[^}]*--crab-art:\s*url\("\/src\/assets\/crab-neutral\.png"\)/s);
  assert.match(css, /\.crab-shell\[data-state="idle-shrink"\][^{]*\{[^}]*--crab-art:\s*url\("\/src\/assets\/crab-shrink\.png"\)/s);
  assert.match(css, /\.crab-shell\[data-state="wave-claw"\]\s+\.crab-sprite\s*\{[^}]*animation:\s*wave-claw-once\s+5s\s+ease-in-out\s+1;/s);
  assert.match(css, /\.crab-shell\[data-state="wink"\]\s+\.crab-sprite\s*\{[^}]*animation:\s*wink-pop\s+900ms\s+ease-in-out\s+2;/s);
  assert.match(css, /width:\s*136px;/);
  assert.match(css, /height:\s*100px;/);
  assert.match(css, /padding:\s*12px;/);
});

test('pet sprite is rendered as a bare transparent layer without panel styling', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const shellRule = css.match(/\.crab-shell\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';
  const spriteRule = css.match(/\.crab-sprite\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? '';

  assert.doesNotMatch(shellRule, /drop-shadow|box-shadow|border-radius/);
  assert.doesNotMatch(spriteRule, /drop-shadow|box-shadow|border-radius/);
  assert.doesNotMatch(shellRule, /background:\s*(?:#|rgb|hsl|linear-gradient|radial-gradient|white|black)/);
  assert.doesNotMatch(spriteRule, /background:\s*(?:#|rgb|hsl|linear-gradient|radial-gradient|white|black)/);
});

test('movement animations stay inside the transparent safety padding', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /translateX\(-(?:1[5-9]|[2-9]\d)px\)/);
  assert.doesNotMatch(css, /translateX\((?:1[5-9]|[2-9]\d)px\)/);
});

test('crawl sprite only steps in place because window locomotion moves across the dock', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const crawlKeyframes = css.slice(css.indexOf('@keyframes crawl-step'), css.indexOf('@keyframes wink-pop'));
  assert.match(css, /\.crab-shell\[data-state="crawl"\]\s+\.crab-sprite\s*\{[^}]*animation:\s*crawl-step\s+600ms\s+ease-in-out\s+infinite;/s);
  assert.doesNotMatch(crawlKeyframes, /translateX/);
  assert.match(css, /\.crab-shell\[data-state="dodge"\][^{]*\{[^}]*--crab-art:\s*url\("\/src\/assets\/crab-crawl\.png"\)/s);
  assert.match(css, /\.crab-shell\[data-state="dodge"\]\s+\.crab-sprite\s*\{[^}]*animation:\s*crawl-step\s+600ms\s+ease-in-out\s+infinite;/s);
});

test('wave-claw animation is a five second one-shot', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.crab-shell\[data-state="wave-claw"\]\s+\.crab-sprite\s*\{[^}]*animation:\s*wave-claw-once\s+5s\s+ease-in-out\s+1;/s,
  );
  assert.match(css, /@keyframes wave-claw-once/);
});

test('sprite and icon assets have transparent corners without green matte', () => {
  for (const asset of [
    'crab-neutral.png',
    'crab-sleep.png',
    'crab-wink.png',
    'crab-wave.png',
    'crab-shrink.png',
    'crab-bubble.png',
    'crab-crawl.png',
    'hermit-crab-icon.png',
  ]) {
    const image = decodeRgbaPng(new URL(`../src/assets/${asset}`, import.meta.url));
    assert.equal(alphaAt(image, 0, 0), 0, `${asset} top-left corner should be transparent`);
    assert.equal(alphaAt(image, image.width - 1, 0), 0, `${asset} top-right corner should be transparent`);
    assert.equal(alphaAt(image, 0, image.height - 1), 0, `${asset} bottom-left corner should be transparent`);
    assert.equal(
      alphaAt(image, image.width - 1, image.height - 1),
      0,
      `${asset} bottom-right corner should be transparent`,
    );
  }
});
