module.exports = {
  doubleWidthUnicodeRanges: [
    '\u2014-\u2015', // em dash, horizontal bar
    '\u2025-\u2026', // two dot leader, horizontal ellipsis
    '\u2030', // per mille sign
    '\u203b', // reference mark
    '\u2190-\u2193', // arrows (←, ↑, →, ↓)
    '\u25a0-\u25ff', // geometric shapes
    '\u2713', // check mark
    '\u2717', // ballot x
    '\u2e80-\u2eff', // CJK Radicals Supplement
    '\u2f00-\u2fdf', // Kangxi Radicals
    '\u3000-\u9fff', // CJK Unified Ideographs
    '\uac00-\ud7af', // Hangul Syllables
    '\uf900-\ufaff', // CJK Compatibility Ideographs
    '\ufe30-\ufe4f', // CJK Compatibility Forms
    '\ufe50-\ufe6f', // Small Form Variants
    '\uff01-\uff60', // Fullwidth ASCII variants
  ],
  narrowOverrideUnicodeRanges: [
    '\u2122', // ™ Trade Mark Sign
    '\u2139', // ℹ Information Source
  ],
};
