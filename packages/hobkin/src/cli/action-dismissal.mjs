import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readVersioned } from './file-version.mjs';

export const DISMISSALS_FILE = 'action-item-dismissals.jsonl';
const pathOf = root => join(root, 'runtime', DISMISSALS_FILE);
const cached = new Map();

function readReceipts(root) {
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
        const receipt = JSON.parse(line);
        return Array.isArray(receipt?.ids) || receipt?.selection ? [receipt] : [];
      } catch {
        // A torn append cannot invalidate the other receipts.
        return [];
      }
    });
  }, 16);
}

export const readDismissedActionIds = root => [...new Set(readReceipts(root).flatMap(({ ids = [], selection }) => selection ? [selection.id] : ids))];

function appendReceipt(root, receipt) {
  const file = pathOf(root);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `\n${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}

export function recordActionDismissals(root, ids, now) {
  if (!ids.length) return;
  appendReceipt(root, { at: new Date(now).toISOString(), disposition: 'dismissed at user request', ids });
}

function selections(root) {
  const selected = new Map();
  for (const { selection } of readReceipts(root)) {
    if (selection) selected.set(selection.id, { ...selected.get(selection.id), ...selection });
  }
  return selected;
}

export const actionSelection = (root, id) => selections(root).get(id);

// Save the choice before dispatch. An interrupted attempt becomes an unknown outcome, never a retry.
export function beginActionSelection(root, { id, title, choice }, now) {
  appendReceipt(root, { selection: { id, title, choice, at: new Date(now).toISOString() } });
}

export function finishActionSelection(root, id, outcome) {
  appendReceipt(root, { selection: { id, outcome } });
}

const reasons = {
  handler: 'No action handler was available; nothing was attempted.',
  target: 'The action target was no longer available; nothing was carried out.',
};

export function actionSelectionNotices(root, active = new Set()) {
  return [...selections(root).values()].filter(({ id, outcome }) => !active.has(id) && outcome !== 'completed').map(({ id, title, choice, at, outcome }) => ({
    id: `notice:action-answer:${id}`,
    role: 'notice',
    tone: 'blocked',
    content: `Action item “${title}” — you chose “${choice}”. ${reasons[outcome] ?? 'The action did not confirm completion; its outcome is unknown.'} The choice was saved and the card was removed. Nothing was retried.`,
    at,
  }));
}
