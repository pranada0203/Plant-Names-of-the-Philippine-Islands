'use strict';
/**
 * Writing generated files without churning them.
 *
 * Every artifact records when it was generated, which is real provenance. It is
 * also, naively written, a guarantee that `npm run build` rewrites four
 * committed files on every run whether or not a byte of the data changed -- so
 * every future diff opens with lines of noise, and `git status` is never quiet
 * enough to tell you that something actually happened.
 *
 * The fix is to make the stamp mean what a reader would assume it means: the
 * time the content last *changed*, not the time the pipeline last ran. If
 * everything but the stamp is identical to what is already on disk, the
 * previous stamp is kept and the bytes stay exactly where they were.
 *
 * The same reasoning already governs the service worker's cache version in
 * stage 3, which hashes the data and the app but never the timestamps.
 */

/** Read a dotted path: `at(obj, 'meta.built')`. */
function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Write a dotted path, doing nothing if a parent is missing. */
function setAt(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  if (target && typeof target === 'object') target[last] = value;
}

/**
 * Write `value` as JSON, keeping the previous timestamp when nothing else
 * changed.
 *
 * @param {string} stamp  dotted path of the generated-at field, e.g. 'meta.built'
 * @param {number|null} space  JSON.stringify indentation
 * @returns {string} the JSON actually written
 */
function writeJson(fs, file, value, { stamp = null, space = null } = {}) {
  if (stamp && fs.existsSync(file)) {
    try {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      const was = at(previous, stamp);
      if (was !== undefined) {
        // Compare with both stamps blanked, so only the data decides.
        const now = at(value, stamp);
        setAt(value, stamp, null);
        setAt(previous, stamp, null);
        const same = JSON.stringify(value, null, space) === JSON.stringify(previous, null, space);
        setAt(value, stamp, same ? was : now);
      }
    } catch {
      // Unreadable, or not JSON: nothing to preserve, so just write the new file.
    }
  }
  const body = JSON.stringify(value, null, space);
  fs.writeFileSync(file, body);
  return body;
}

module.exports = { writeJson };
