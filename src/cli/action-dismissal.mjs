import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readVersioned } from './file-version.mjs';

export const DISMISSALS_FILE = 'action-item-dismissals.jsonl';
const pathOf = root => join(root, 'runtime', DISMISSALS_FILE);
const cached = new Map();

export function readDismissedActionIds(root) {
  const file = pathOf(root);
  return readVersioned(cached, file, () => {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return text.split('\n').filter(Boolean).flatMap(line => {
      try {
        const { ids } = JSON.parse(line);
        return Array.isArray(ids) ? ids : [];
      } catch {
        // A torn append cannot invalidate the other receipts.
        return [];
      }
    });
  }, 16);
}

export function recordActionDismissals(root, ids, now) {
  if (!ids.length) return;
  const file = pathOf(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const receipt = { at: new Date(now).toISOString(), disposition: 'dismissed at user request', ids };
  appendFileSync(file, `\n${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}
