// Smoke test for injectVttHighlight() — extracts the function from
// video-examples-modal.js via regex (avoids ESM resolution of `log`/types)
// and runs it against a representative VTT payload.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalPath = resolve(__dirname, '../ext/js/display/video-examples-modal.js');
const src = readFileSync(modalPath, 'utf8');

const match = src.match(/function injectVttHighlight\([\s\S]*?\n\}\n/);
if (match === null) {
    console.error('FAIL: injectVttHighlight() not found in modal.js');
    process.exit(2);
}
const injectVttHighlight = new Function(`${match[0]} return injectVttHighlight;`)();

let pass = 0;
let fail = 0;
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function expect(name, ok, detail = '') {
    if (ok) { console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
    else { console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`); fail++; }
}

console.log('\n\x1b[1mFunctional smoke test — injectVttHighlight()\x1b[0m');

const vtt = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:04.000',
    "Here's the breakdown for the people.",
    '',
    '2',
    '00:00:05.000 --> 00:00:08.000',
    'A people\'s republic of people.',
    '',
].join('\n');

const out = injectVttHighlight(vtt, ['people']);

expect('header WEBVTT unchanged',
    out.startsWith('WEBVTT\n'));
expect('timestamp lines untouched',
    out.includes('00:00:01.000 --> 00:00:04.000'));
expect('first "people" wrapped',
    out.includes("breakdown for the <c.hl>people</c>."));
expect('second cue: both "people" tokens wrapped',
    /A <c\.hl>people<\/c>'s republic of <c\.hl>people<\/c>\./u.test(out));
expect('cue identifier ("1", "2") not wrapped',
    out.match(/^1$/m) !== null && out.match(/^2$/m) !== null);

// Edge: words array empty → unchanged
expect('empty words array → input unchanged',
    injectVttHighlight(vtt, []) === vtt);

// Edge: cue containing < and & — must be escaped before wrapping
const vttWithHtml = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'people & <script>alert(1)</script>',
    '',
].join('\n');
const escaped = injectVttHighlight(vttWithHtml, ['people']);
expect('special chars (&, <, >) escaped in cue payload',
    escaped.includes('&amp;') &&
    escaped.includes('&lt;script&gt;') &&
    !escaped.includes('<script>'));

// Edge: longer-form preferred over shorter-form (longest-first alternation)
const vttLong = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'I see people of people',
    '',
].join('\n');
const long = injectVttHighlight(vttLong, ['people', 'people of people']);
expect('longest-first alternation matches longest run',
    long.includes('<c.hl>people of people</c>'));

// Edge: word-boundary respected (don't match inside "peoples")
const vttBoundary = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'two peoples of people',
    '',
].join('\n');
const bound = injectVttHighlight(vttBoundary, ['people']);
expect('word-boundary respected ("peoples" not wrapped, "people" is)',
    bound.includes('two peoples of <c.hl>people</c>'));

console.log(`\n\x1b[1mSummary\x1b[0m  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
