'use strict';

const fs = require('fs');
const Base = require('lowdb/adapters/Base');

// Scans a truncated JSON.stringify() output and rebuilds a valid document by
// cutting back to the last point that was a complete value (right after a
// closing "}"/"]", or right before a "," that separates sibling values) and
// closing whatever containers were still open at that point. Only handles
// truncation (missing content at the end) -- not other kinds of corruption.
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false;
  let escapeNext = false;
  let lastSafeEnd = -1;
  let lastSafeStack = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      stack.pop();
      lastSafeEnd = i + 1;
      lastSafeStack = stack.slice();
      continue;
    }
    if (ch === ',' && stack.length > 0) {
      lastSafeEnd = i;
      lastSafeStack = stack.slice();
    }
  }

  if (lastSafeEnd < 0 || !lastSafeStack || lastSafeStack.length === 0) {
    throw new Error('no safe truncation point found -- this is not a simple truncated write');
  }

  let repaired = text.slice(0, lastSafeEnd);
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    repaired += lastSafeStack[i] === '{' ? '}' : ']';
  }
  return repaired;
}

function summarizeRecovery(parsed) {
  if (!parsed || typeof parsed !== 'object') return '(not an object)';
  return Object.keys(parsed)
    .map(k => (Array.isArray(parsed[k]) ? `${k}: ${parsed[k].length}` : k))
    .join(', ');
}

// lowdb's stock FileSync adapter (node_modules/lowdb/adapters/FileSync.js)
// writes the WHOLE serialized database with one non-atomic fs.writeFileSync
// on every save, and its read() throws straight out of `require('./db')` --
// a module-load-time crash, before Express ever starts -- on any parse
// error. Both bit us on a real deploy: an OOM kill (images are stored
// inline as base64 in this same file with no cap on world covers/portraits,
// see CHANGELOG) landed mid-write, truncating db.json, and every restart
// since then crashed on "Unexpected end of JSON input" with no way to
// recover -- a single bad write could permanently brick the app.
//
// This adapter fixes both ends: write() now goes to a temp file + rename
// (atomic on Linux -- a kill mid-write leaves the OLD file intact instead
// of a half-written one), and read() attempts a bracket-matching repair of
// a truncated file before giving up, so a future crash-mid-write loses at
// worst the last few in-flight records instead of the entire database. The
// original corrupted file is always preserved (renamed aside, never
// deleted) so a bad repair can still be recovered from by hand.
class SafeFileSync extends Base {
  read() {
    if (!fs.existsSync(this.source)) {
      fs.writeFileSync(this.source, this.serialize(this.defaultValue));
      return this.defaultValue;
    }
    const raw = fs.readFileSync(this.source, 'utf-8').trim();
    if (!raw) return this.defaultValue;

    try {
      return this.deserialize(raw);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      console.error(`[db] ${this.source} failed to parse (${e.message}) -- attempting repair of a truncated write`);

      const backupPath = `${this.source}.corrupted-${Date.now()}`;
      fs.copyFileSync(this.source, backupPath);

      try {
        const repaired = repairTruncatedJson(raw);
        const parsed = this.deserialize(repaired);
        fs.writeFileSync(this.source, this.serialize(parsed));
        console.error(`[db] Repaired truncated database. Recovered -- ${summarizeRecovery(parsed)}. Original corrupted file preserved at ${backupPath}.`);
        return parsed;
      } catch (repairError) {
        console.error(`[db] Could not repair ${this.source} (${repairError.message}). Starting from an empty database so the app can boot. The corrupted file was NOT deleted -- preserved at ${backupPath} for manual recovery.`);
        fs.writeFileSync(this.source, this.serialize(this.defaultValue));
        return this.defaultValue;
      }
    }
  }

  write(data) {
    const tmpPath = `${this.source}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, this.serialize(data));
    fs.renameSync(tmpPath, this.source);
  }
}

module.exports = SafeFileSync;
module.exports.repairTruncatedJson = repairTruncatedJson;
