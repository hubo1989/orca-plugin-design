import { pathToFileURL } from 'node:url';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degrees = radians => ((radians * 180 / Math.PI) % 360 + 360) % 360;

function parseHex(hex) {
  if (typeof hex !== 'string' || !/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) {
    throw new TypeError('Expected a 3- or 6-digit RGB hex color');
  }
  let digits = hex.replace(/^#/, '');
  if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255);
}

const linearize = value => value <= 0.04045
  ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encode = value => value <= 0.0031308
  ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
const rgbToHex = rgb => '#' + rgb.map(value =>
  Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0')
).join('').toUpperCase();

/** CSS OKLCH: L is 0..1, C is unscaled, H is degrees in [0, 360). */
export function hexToOklch(hex) {
  const [r, g, b] = parseHex(hex).map(linearize);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(a, labB);
  // The published matrices leave tiny residual chroma on neutral colors.
  return { L, C: C < 1e-7 ? 0 : C, H: C < 1e-7 ? 0 : degrees(Math.atan2(labB, a)) };
}

function oklchToLinearRgb({ L, C, H }) {
  if (![L, C, H].every(Number.isFinite) || L < 0 || L > 1 || C < 0) {
    throw new RangeError('OKLCH requires finite L in [0, 1], C >= 0 and H in degrees');
  }
  const angle = (H % 360) * Math.PI / 180;
  const a = C * Math.cos(angle);
  const b = C * Math.sin(angle);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** Out-of-gamut components are clipped; output is canonical 8-bit #RRGGBB. */
export function oklchToHex(color) {
  return rgbToHex(oklchToLinearRgb(color).map(encode));
}

function readRange(opts, name, fallback) {
  const range = opts[name] ?? [opts[`min${name}`] ?? fallback[0], opts[`max${name}`] ?? fallback[1]];
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
    || range[0] < 0 || range[0] > range[1] || (name === 'L' && range[1] > 1)) {
    throw new RangeError(`${name} must be an ordered [min, max] range`);
  }
  return range;
}

/**
 * opts: { L: [0.35, 0.85], C: [0.04, 0.20] }; minL/maxL/minC/maxC also work.
 * Preserve hue, reduce chroma to fit sRGB, then account for 8-bit quantization.
 * Unrepresentable ranges throw rather than silently returning an invalid color.
 */
export function constrainBrandColor(hex, opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError('opts must be an object');
  }
  const [minL, maxL] = readRange(opts, 'L', [0.35, 0.85]);
  const [minC, maxC] = readRange(opts, 'C', [0.04, 0.20]);
  const originalHex = rgbToHex(parseHex(hex));
  const original = hexToOklch(hex);
  const allowed = color => color.L >= minL && color.L <= maxL
    && color.C >= minC && color.C <= maxC;
  if (allowed(original)) return { hex: originalHex, changed: false };

  const target = { L: clamp(original.L, minL, maxL), C: clamp(original.C, minC, maxC), H: original.H };
  const inGamut = color => oklchToLinearRgb(color).every(v => v >= -1e-7 && v <= 1 + 1e-7);
  if (!inGamut(target)) {
    let low = 0;
    let high = target.C;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (inGamut({ ...target, C: mid })) low = mid;
      else high = mid;
    }
    target.C = low;
  }
  const rounded = oklchToHex(target);
  if (allowed(hexToOklch(rounded))) return { hex: rounded, changed: rounded !== originalHex };

  // Boundary rounding can move L/C outside the requested interval. Select the
  // closest representable neighbor that actually satisfies both constraints.
  const center = parseHex(rounded).map(v => Math.round(v * 255));
  let best;
  let bestDistance = Infinity;
  const targetAngle = target.H * Math.PI / 180;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dg = -2; dg <= 2; dg++) {
      for (let db = -2; db <= 2; db++) {
        const candidate = rgbToHex(center.map((v, i) => (v + [dr, dg, db][i]) / 255));
        const color = hexToOklch(candidate);
        if (!allowed(color)) continue;
        const angle = color.H * Math.PI / 180;
        const distance = (color.L - target.L) ** 2
          + (color.C * Math.cos(angle) - target.C * Math.cos(targetAngle)) ** 2
          + (color.C * Math.sin(angle) - target.C * Math.sin(targetAngle)) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
  }
  if (!best) throw new RangeError('No nearby 8-bit sRGB color satisfies the requested L/C ranges');
  return { hex: best, changed: best !== originalHex };
}

/** WCAG 2.x relative luminance contrast, from 1 to 21. */
export function contrastRatio(hexA, hexB) {
  const luminance = hex => {
    const [r, g, b] = parseHex(hex).map(linearize);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function pickTextColor(bgHex) {
  return contrastRatio(bgHex, '#000000') >= contrastRatio(bgHex, '#FFFFFF')
    ? '#000000' : '#FFFFFF';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: assert } = await import('node:assert/strict');
  let passed = 0;
  const test = (name, run) => {
    run();
    passed++;
    console.log(`PASS ${name}`);
  };
  test('white L=1; black L=0', () => {
    assert.ok(Math.abs(hexToOklch('#FFFFFF').L - 1) < 1e-7);
    assert.equal(hexToOklch('#000').L, 0);
  });
  test('black/white WCAG contrast=21; identical contrast=1', () => {
    assert.ok(Math.abs(contrastRatio('#000', '#fff') - 21) < 1e-12);
    assert.equal(contrastRatio('#FF6B35', '#FF6B35'), 1);
    assert.ok(Math.abs(contrastRatio('#777777', '#FFFFFF') - 4.478089453577214) < 1e-12);
  });
  test('#FF6B35 brand constraint before/after', () => {
    const result = constrainBrandColor('#FF6B35');
    assert.deepEqual(result, { hex: '#FF6B35', changed: false });
    console.log(JSON.stringify({ before: hexToOklch('#FF6B35'), result, after: hexToOklch(result.hex) }));
  });
  test('excess chroma converges inside allowed interval', () => {
    assert.ok(hexToOklch('#0000FF').C > 0.20);
    const result = constrainBrandColor('#0000FF');
    const color = hexToOklch(result.hex);
    assert.equal(result.changed, true);
    assert.ok(color.L >= 0.35 && color.L <= 0.85 && color.C >= 0.04 && color.C <= 0.20);
    assert.deepEqual(constrainBrandColor(result.hex), { hex: result.hex, changed: false });
    console.log(JSON.stringify({ input: '#0000FF', result, oklch: color }));
  });
  test('pickTextColor on black and white backgrounds', () => {
    assert.equal(pickTextColor('#000'), '#FFFFFF');
    assert.equal(pickTextColor('#fff'), '#000000');
  });
  test('hex -> OKLCH -> hex normalized RGB error <1e-6', () => {
    for (const hex of ['#000000', '#FFFFFF', '#FF6B35', '#FF0000', '#00FF00', '#0000FF', '#123456', '#808080']) {
      const roundTrip = parseHex(oklchToHex(hexToOklch(hex)));
      const input = parseHex(hex);
      assert.ok(Math.max(...input.map((v, i) => Math.abs(v - roundTrip[i]))) < 1e-6, hex);
    }
  });
  test('custom ranges, neutral colors and boundary gamut mapping', () => {
    for (const hex of ['#000', '#fff', '#808080', '#FF0000', '#00FF00', '#00FFFF', '#FF00FF']) {
      const color = hexToOklch(constrainBrandColor(hex).hex);
      assert.ok(color.L >= 0.35 && color.L <= 0.85 && color.C >= 0.04 && color.C <= 0.20, hex);
    }
    const result = constrainBrandColor('#FF6B35', { L: [0.4, 0.6], C: [0.04, 0.1] });
    const color = hexToOklch(result.hex);
    assert.ok(color.L >= 0.4 && color.L <= 0.6 && color.C >= 0.04 && color.C <= 0.1);
    assert.equal(result.changed, true);
  });
  test('invalid input and impossible ranges fail explicitly', () => {
    assert.throws(() => hexToOklch('#zzzzzz'), TypeError);
    assert.throws(() => oklchToHex({ L: NaN, C: 0.1, H: 0 }), RangeError);
    assert.throws(() => constrainBrandColor('#fff', { L: [0.8, 0.2] }), RangeError);
    assert.throws(() => constrainBrandColor('#000', { L: [0, 0], C: [1, 1] }), RangeError);
  });
  console.log(`${passed}/${passed} self-tests passed`);
}
