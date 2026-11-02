import { SESSION_TAB, WorkPanes } from './work/panes.mjs';

const POLL_MS = 10000;
const [name, pane, report, kind] = process.argv.slice(2);

const handed = kind === 'handed';
const panes = new WorkPanes({ pollMs: POLL_MS, ...(handed ? {} : { tab: SESSION_TAB }) });

// A session ends with its report. A review writes none, and it ends when the user leaves it. A run left going by a closed hobkin ends like the run it was.
if (handed) await panes.followHanded({ name, pane, report });
else await (report ? panes.followSession({ name, pane, report }) : panes.followReview({ name, pane }));
