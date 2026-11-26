'use strict';
/** Estate code: exactly 6 capital letters, globally unique. Letters I and O are left out of suggestions (easy to misread as 1 and 0). */
const crypto = require('crypto');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '');
const isValid = (c) => /^[A-Z]{6}$/.test(c);
const rand = (n) => Array.from({ length: n }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');

/** "Test Estate Lagos" -> TEL + 3 random letters. `taken(code)` is async and says whether the code already exists. */
async function suggest(name, taken) {
  const initials = String(name || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean).map((w) => w[0]).filter((ch) => ALPHA.includes(ch)).join('').slice(0, 3);
  for (let i = 0; i < 30; i++) {
    const code = (initials + rand(6)).slice(0, 6);
    if (isValid(code) && !(await taken(code))) return code;
  }
  throw new Error('Could not find a free estate code');
}
module.exports = { normalize, isValid, suggest, rand };
