import { SESSION_TAB, WorkPanes } from './work/panes.mjs';

const POLL_MS = 10000;
const [name, pane, report] = process.argv.slice(2);

const panes = new WorkPanes({ pollMs: POLL_MS, tab: SESSION_TAB });

// A session ends with its report. A review writes none, and it ends when the user leaves it.
await (report ? panes.followSession({ name, pane, report }) : panes.followReview({ name, pane }));
