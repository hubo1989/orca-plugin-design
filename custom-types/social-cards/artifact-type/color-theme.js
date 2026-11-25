/* SPDX-License-Identifier: MIT */
/* OKLCH color constraints & WCAG 2.x contrast utilities for Orca Social Cards */
(function (global) {
  'use strict';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function degrees(radians) {
    return ((radians * 180 / Math.PI) % 360 + 360) % 360;
  }

  function parseHex(hex) {
    if (typeof hex !== 'string' || !/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex.trim())) {
      throw new TypeError('Expected a 3- or 6-digit RGB hex color');
    }
    var digits = hex.trim().replace(/^#/, '');
    if (digits.length === 3) {
      digits = digits.split('').map(function (c) { return c + c; }).join('');
    }
    return [0, 2, 4].map(function (idx) {
      return parseInt(digits.slice(idx, idx + 2), 16) / 255;
    });
  }

  function linearize(value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function encode(value) {
    return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (value) {
      return Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function hexToOklch(hex) {
    var rgb = parseHex(hex).map(linearize);
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var labB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var C = Math.hypot(a, labB);
    return { L: L, C: C < 1e-7 ? 0 : C, H: C < 1e-7 ? 0 : degrees(Math.atan2(labB, a)) };
  }

  function oklchToLinearRgb(color) {
    var L = color.L, C = color.C, H = color.H;
    var angle = (H % 360) * Math.PI / 180;
    var a = C * Math.cos(angle);
    var b = C * Math.sin(angle);
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  function oklchToHex(color) {
    return rgbToHex(oklchToLinearRgb(color).map(encode));
  }

  function constrainBrandColor(hex, opts) {
    var o = opts || {};
    var LRange = o.L || [0.35, 0.85];
    var CRange = o.C || [0.04, 0.20];
    var minL = LRange[0], maxL = LRange[1];
    var minC = CRange[0], maxC = CRange[1];
    var originalHex = rgbToHex(parseHex(hex));
    var original = hexToOklch(originalHex);
    function allowed(c) {
      return c.L >= minL && c.L <= maxL && c.C >= minC && c.C <= maxC;
    }
    if (allowed(original)) return { hex: originalHex, changed: false, oklch: original };

    var target = { L: clamp(original.L, minL, maxL), C: clamp(original.C, minC, maxC), H: original.H };
    function inGamut(c) {
      return oklchToLinearRgb(c).every(function (v) { return v >= -1e-7 && v <= 1 + 1e-7; });
    }
    if (!inGamut(target)) {
      var low = 0, high = target.C;
      for (var i = 0; i < 48; i++) {
        var mid = (low + high) / 2;
        if (inGamut({ L: target.L, C: mid, H: target.H })) low = mid;
        else high = mid;
      }
      target.C = low;
    }
    var rounded = oklchToHex(target);
    if (allowed(hexToOklch(rounded))) {
      return { hex: rounded, changed: rounded !== originalHex, oklch: hexToOklch(rounded) };
    }
    var center = parseHex(rounded).map(function (v) { return Math.round(v * 255); });
    var best = rounded;
    var bestDist = Infinity;
    var targetAngle = target.H * Math.PI / 180;
    for (var dr = -2; dr <= 2; dr++) {
      for (var dg = -2; dg <= 2; dg++) {
        for (var db = -2; db <= 2; db++) {
          var cand = rgbToHex([
            (center[0] + dr) / 255,
            (center[1] + dg) / 255,
            (center[2] + db) / 255
          ]);
          var col = hexToOklch(cand);
          if (!allowed(col)) continue;
          var angle = col.H * Math.PI / 180;
          var dist = Math.pow(col.L - target.L, 2)
            + Math.pow(col.C * Math.cos(angle) - target.C * Math.cos(targetAngle), 2)
            + Math.pow(col.C * Math.sin(angle) - target.C * Math.sin(targetAngle), 2);
          if (dist < bestDist) {
            bestDist = dist;
            best = cand;
          }
        }
      }
    }
    return { hex: best, changed: best !== originalHex, oklch: hexToOklch(best) };
  }

  function luminance(hex) {
    var rgb = parseHex(hex).map(linearize);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrastRatio(hexA, hexB) {
    var a = luminance(hexA);
    var b = luminance(hexB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function pickTextColor(bgHex) {
    return contrastRatio(bgHex, '#000000') >= contrastRatio(bgHex, '#FFFFFF') ? '#000000' : '#FFFFFF';
  }

  global.OrcaColorTheme = {
    hexToOklch: hexToOklch,
    oklchToHex: oklchToHex,
    constrainBrandColor: constrainBrandColor,
    contrastRatio: contrastRatio,
    pickTextColor: pickTextColor
  };
})(window);
