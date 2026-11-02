import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  Editor, Input, Markdown, ProcessTerminal, SelectList, TuiAltScreen, getCapabilities, getKeybindings, matchesKey, setCapabilityOverrides,
  stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import { FACE_COLUMNS, faceLines, supportsOctants } from './face.mjs';
import { FaceImages, IMAGE_FACE_COLUMNS, supportsFaceImages } from './face-images.mjs';
import { currentMood } from './mood.mjs';
import { FRAME_MS, Slide, fadeColors } from './motion.mjs';
import { followPiTheme } from './theme.mjs';
import { lookTime, shortPath } from './work/chat.mjs';
import { byPriority, byRank, foldersLeft, grades, prModes, tokenLabel } from './work/store.mjs';

// The caller supplies already-loaded arrays; render never reads history or starts work.
const clean = value => stripTerminalSequences(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const cleanLines = value => stripTerminalSequences(String(value ?? '')).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ');
const line = (value, width) => truncateToWidth(value, Math.max(1, width));
const cell = (value, width) => {
  const text = line(value, width);
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
};
const wrapped = (value, width) => String(value ?? '').split('\n').flatMap(part =>
  wrapTextWithAnsi(clean(part), Math.max(1, width)));
const row = (left, right, width) => cell(left, Math.max(1, width - visibleWidth(right) - 2)) + '  ' + right;
const centered = (value, width) => ' '.repeat(Math.max(0, Math.floor((width - visibleWidth(value)) / 2))) + value;
const key = (data, name) => matchesKey(data, name);
const count = (amount, noun) => `${amount} ${noun}${amount === 1 ? '' : 's'}`;

const style = (open, close) => text => `\x1b[${open}m${text}\x1b[${close}m`;
const color = (...rgb) => style(`38;2;${rgb.join(';')}`, 39);
const bold = style(1, 22);
const pink = color(255, 121, 198);
const purple = color(189, 147, 249);
const cyan = color(139, 233, 253);
const green = color(80, 250, 123);
const orange = color(255, 184, 108);
const slate = color(157, 168, 186);
const comment = color(98, 114, 164);
const shadow = color(68, 71, 90);
// Dracula until the fullscreen dashboard loads the user's Pi theme (see theme.mjs for the same roles).
const builtInPalette = {
  face: { theme: 'dark', hood: [240, 234, 214], eye: [232, 163, 23] },
  dim: slate,
  muted: comment,
  faint: shadow,
  accent: cyan,
  warning: color(241, 250, 140),
  caution: orange,
  assistant: purple,
  effort: () => orange,
  highlight: pink,
  positive: green,
  negative: color(255, 85, 85),
  selection: '\x1b[48;2;68;71;90m',
  gradient: [[255, 121, 198], [189, 147, 249]],
  markdown: {
    heading: text => purple(bold(text)),
    link: cyan,
    linkUrl: comment,
    code: green,
    codeBlock: text => text,
    codeBlockBorder: shadow,
    quote: slate,
    quoteBorder: shadow,
    hr: shadow,
    listBullet: pink,
    bold,
    italic: style(3, 23),
    strikethrough: style(9, 29),
    underline: style(4, 24),
  },
  select: {
    selectedPrefix: pink,
    selectedText: text => pink(bold(text)),
    description: slate,
    scrollInfo: comment,
    noMatch: slate,
  },
};
let palette = builtInPalette;
const dim = text => palette.dim(text);
const muted = text => palette.muted(text);
const faint = text => palette.faint(text);
const accent = text => palette.accent(text);
const warning = text => palette.warning(text);
const caution = text => palette.caution(text);
const assistantColor = text => palette.assistant(text);
const effortTone = level => text => palette.effort(level)(text);
const highlight = text => palette.highlight(text);
const positive = text => palette.positive(text);
const negative = text => palette.negative(text);
// Open questions keep their list across theme changes, so the list theme reads the palette at render time.
const selectTheme = {
  selectedPrefix: text => palette.select.selectedPrefix(text),
  selectedText: text => palette.select.selectedText(text),
  description: text => palette.select.description(text),
  scrollInfo: text => palette.select.scrollInfo(text),
  noMatch: text => palette.select.noMatch(text),
};
const OTHER_ROW = { value: 'other', label: 'Other: type your own answer' };
const FEWEST_CHOICES_SHOWN = 3;
const PRINTABLE_KEY = /^[^\x00-\x1f\x7f]$/u;
// The question's box, the footer and the few rows of conversation that always stay in sight.
const ROWS_AROUND_CHOICES = 12;
const gradient = (value, from, to) => {
  const characters = [...value];
  const painted = characters.map((character, index) => {
    const ratio = index / Math.max(1, characters.length - 1);
    const channels = from.map((start, channel) => Math.round(start + (to[channel] - start) * ratio));
    return `\x1b[38;2;${channels.join(';')}m${character}`;
  });
  return `${painted.join('')}\x1b[39m`;
};
// 256-color themes have no RGB endpoints, so the name falls back to the solid accent.
const brand = wordmark => {
  if (wordmark) return `${highlight('◆')} ${wordmark}`;
  const [from, to] = palette.gradient;
  const name = from && to ? gradient('hobkin', from, to) : highlight('hobkin');
  return `${highlight('◆')} ${bold(name)}`;
};
// Re-open the background after resets so truncated, styled text keeps the selection bar intact.
const selectedRow = (value, width) => {
  const content = cell(value, width).replaceAll('\x1b[0m', `\x1b[0m${palette.selection}`);
  return `${palette.selection}${content}\x1b[49m`;
};
const spinner = at => '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(at / 100) % 10];
const spaced = () => muted('  ·  ');
const keys = pairs => pairs.map(([input, action]) => `${dim(input)} ${muted(action)}`).join(spaced());
const gauge = percent => {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  const tone = percent >= 80 ? negative : percent >= 50 ? caution : accent;
  return tone('━'.repeat(filled)) + faint('━'.repeat(10 - filled));
};
const noticeStyles = {
  error: ['✕', negative],
  warning: ['▲', caution],
  success: ['✓', positive],
};
const TIP_EVERY_MS = 180000;
const TIP_SHOW_MS = 30000;
const IDLE_REDRAW_MS = 5000;
const FOOTER_RULE_SHARE = 0.65;
const MIN_ROWS_FOR_TIP_LINE = 20;
const MIN_WIDTH_FOR_FACE = 72;
const FACE_GAP = 1;
const QUIT_WINDOW_MS = 3000;
const ACTIVE_FRAME_MS = 100;
const MOVING_FACE_MS = 125;
const RESTING_FACE_MS = 250;
const MIN_ROWS_FOR_PINNED_DAY = 8;
const MAX_REPOSITORIES_SHOWN = 8;
// With no row picked yet, the tab opens on the first thing that needs an answer.
const answerableRows = ['allowance', 'proposal'];
const workTabs = [{ name: 'now', label: 'Now' }, { name: 'done', label: 'Done' }];
const doneRowTypes = ['ready', 'yours', 'elsewhere'];
const localCommands = [
  ['/help', 'what hobkin can do'],
  ['/setup', 'get hobkin ready'],
  ['/clear', 'hide visible chat'],
  ['/reset', 'start a fresh main context'],
  ['/work', 'work mode'],
  ['/jev', 'moods'],
  ['/learning', 'learn from outcomes'],
];
const settingCommands = {
  '/jev': {
    name: 'Jev',
    toggle: 'toggleJev',
    on: 'Jev on. hobkin can show all 18 moods.',
    off: 'Jev off. hobkin keeps its four moods.',
  },
  '/learning': {
    name: 'Learning',
    toggle: 'toggleLearning',
    on: 'Learning on. Every agent now gets what past outcomes taught. Run hobkin learning to see it.',
    off: 'Learning off. Nothing is judged, and agents get nothing.',
  },
};
const SETUP_REQUEST = 'Help me set up hobkin.';
const helpGuide = readFileSync(new URL('../prompts/help.md', import.meta.url), 'utf8');
const tips = [
  'Type /help to see what hobkin can do.',
  'Try another model or thinking effort? Just ask hobkin.',
  'Each routine can have its own model and thinking effort.',
  'Ask hobkin to run any check now, even a paused one.',
  'Ask why a check stopped. Every check keeps a run log.',
  'Tell hobkin what matters. It remembers across chats.',
  '/clear hides the chat. /reset starts a fresh conversation.',
  'Install Hex and talk to me when you need: https://anoma.ly/hex/',
];
const jevTip = 'Type /jev so hobkin can show all 18 moods.';
const learningTip = 'Type /learning so hobkin learns from how its work turns out.';
const greetings = [
  name => `Welcome ${name}! Nice to see you again.`,
  name => `Welcome back, ${name}. Good to see you.`,
  name => `Hey ${name}, glad you're back.`,
  name => `Good to see you again, ${name}.`,
  name => `There you are, ${name}. Nice to have you back.`,
  name => `Hello again, ${name}!`,
  name => `${name}! You're back. Let's get going.`,
];
const ignoredTips = attention => attention.filter(item => item.ignored).map(({ title, read, reports }) =>
  `${clean(title)}: ${read} of ${reports} reports opened. Revisit it?`);
const pickFrom = (choices, turn) => choices[(Math.imul(turn + 1, 2654435761) >>> 16) % choices.length];
// Tips follow the clock rather than a timer, so each one holds still for its whole turn on screen.
const tipAt = (choices, clock) => {
  if (clock % TIP_EVERY_MS >= TIP_SHOW_MS) return '';
  return pickFrom(choices, Math.floor(clock / TIP_EVERY_MS));
};
const toned = (text, tone, frame) => {
  const [glyph, paint] = tone === 'progress' ? [frame, highlight] : noticeStyles[tone] ?? ['', dim];
  return paint(`${glyph ? `${glyph} ` : ''}${clean(text)}`);
};
const outcomes = {
  completed: ['●', positive],
  findings: ['●', positive],
  no_change: ['○', dim],
  incomplete: ['◐', caution],
  interrupted: ['◐', caution],
  failed: ['✕', negative],
  cancelled: ['○', muted],
  imported: ['◇', muted],
};
const outcome = value => Object.hasOwn(outcomes, value) ? outcomes[value] : ['•', dim];
const reportKinds = [
  { name: 'all', label: 'All' },
  { name: 'scheduled', label: 'Scheduled' },
  { name: 'done', label: 'Work Done' },
];
const reportKindOf = ({ scheduleId }) => (String(scheduleId ?? '').startsWith('work.') ? 'done' : 'scheduled');
// A routine's report wears the dot of the Routines tab, so the two kinds tell apart at a glance. Anything that went wrong looks the same on both.
const reportMark = report => {
  const [glyph, tone] = outcome(report.outcome);
  return tone === positive && reportKindOf(report) === 'scheduled' ? accent(glyph) : tone(glyph);
};
const kilobytes = bytes => `${Number((bytes / 1024).toFixed(1))}kb`;

const pad = value => String(value).padStart(2, '0');
const until = (at, now) => {
  const minutes = (Date.parse(at) - now) / 60000;
  if (minutes <= 0) return 'due now';
  if (Math.round(minutes) < 1) return 'in <1m';
  if (Math.round(minutes) < 60) return `in ${Math.round(minutes)}m`;
  if (Math.round(minutes / 60) < 24) return `in ${Math.round(minutes / 60)}h`;
  return `in ${Math.round(minutes / 1440)}d`;
};
const every = minutes => {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  if (minutes > 60) return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
  return `${minutes}m`;
};
const elapsed = (since, now) => {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
};
const relativeTime = (at, now, elapsed = false) => {
  const seconds = (now - at) / 1000;
  const distance = Math.abs(seconds);
  const unit = distance < 60 ? 'second' : distance < 3600 ? 'minute' : distance < 86400 ? 'hour' : 'day';
  const amount = Math.floor(distance / ({ second: 1, minute: 60, hour: 3600, day: 86400 }[unit]));
  const label = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  return elapsed ? seconds < 0 ? 'start is in the future' : `${label} elapsed`
    : seconds < 0 ? `in ${label}` : `${label} ago`;
};
const fixedTime = at => {
  const date = new Date(at);
  const zone = new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(date)
    .find(part => part.type === 'timeZoneName').value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`;
};
const timestamp = (value, now, elapsed = false) => {
  const at = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? `${relativeTime(at, now, elapsed)} · ${fixedTime(at)}`
    : '';
};
const timeOf = value => {
  let at = NaN;
  if (typeof value === 'number') at = value;
  else if (typeof value === 'string' && value.trim()) at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
};
const dayOf = at => at === null ? null : new Date(at).toDateString();
const clockTime = at => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const dayLabel = (at, now) => {
  const date = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const year = date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' };
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', ...year }).format(date);
};
const dayHeading = (at, clock) => muted(bold((at === null ? 'Undated' : dayLabel(at, clock)).toUpperCase()));
// A report's first substantive line, skipping rules, generic headings and lines that repeat its title.
const summaryOf = report => {
  const title = clean(report.title).trim().toLowerCase();
  for (const source of String(report.body ?? '').slice(0, 4000).split('\n')) {
    const text = clean(source)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`|~~/g, '')
      .replace(/^\s*(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const isRule = /^[-=_*\s]+$/.test(text);
    const repeatsTitle = Boolean(title) && text.toLowerCase().includes(title);
    if (text.length >= 12 && !isRule && !repeatsTitle) return text;
  }
  return '';
};

const boxed = ({ paint, top = '', bottom = '', lines, inner }) => {
  const edge = (start, label, end) => paint(`${start}${label ? '─ ' : ''}`) + (label ? `${label} ` : '')
    + paint('─'.repeat(Math.max(0, inner - 2 - (label ? visibleWidth(label) + 3 : 0))) + end);
  const sides = lines.map(value => `${paint('│')} ${cell(value, inner - 4)} ${paint('│')}`);
  return [edge('╭', top, '╮'), ...sides, edge('╰', bottom, '╯')];
};
const ruled = ({ paint, top = '', bottom = '', lines, inner }) => {
  const edge = label => (label
    ? `${paint('─ ')}${label} ${paint('─'.repeat(Math.max(0, inner - visibleWidth(label) - 3)))}`
    : paint('─'.repeat(inner)));
  return [edge(top), ...lines, edge(bottom)];
};
const TAB_GAP = '   ';
const tabText = ({ name, label, count = '', prefix = '' }, active) => {
  const title = active ? highlight(bold(label)) : dim(label);
  const badge = count ? ` ${active ? highlight(count) : muted(count)}` : '';
  const text = `${prefix}${title}${badge}`;
  return { name, text, active, width: visibleWidth(text) };
};
// Where each tab landed, so a click can find it. The gaps between tabs belong to neither side.
const tabZones = (tabs, y, left) => {
  let from = left;
  return tabs.map(({ name, width }) => {
    const zone = { name, y, from, to: from + width };
    from = zone.to + TAB_GAP.length;
    return zone;
  });
};
// Tabs share the brand row when everything fits, shortening the status before giving up the row, because a
// second row would push the whole screen down each time a job starts. Otherwise they get a row windowed around the active tab.
const headerLines = ({ tabs, statuses, inner, wordmark }) => {
  const span = (from, to) => tabs.slice(from, to + 1).reduce((sum, tab) => sum + tab.width, 0) + TAB_GAP.length * (to - from);
  const activeTab = Math.max(0, tabs.findIndex(tab => tab.active));
  const brandText = brand(wordmark);
  const brandWidth = visibleWidth(brandText);
  const tabsEnd = brandWidth + 4 + span(0, tabs.length - 1) + 2;
  const inlineStatus = statuses.find(status => tabsEnd + visibleWidth(status) <= inner);
  const inline = inlineStatus !== undefined;
  let first = 0;
  let last = tabs.length - 1;
  if (span(first, last) > inner) {
    first = activeTab;
    last = activeTab;
    for (let grown = true; grown;) {
      grown = false;
      if (last + 1 < tabs.length && span(first, last + 1) <= inner - 4) {
        last++;
        grown = true;
      }
      if (first > 0 && span(first - 1, last) <= inner - 4) {
        first--;
        grown = true;
      }
    }
  }
  const before = first > 0 ? muted('‹ ') : '';
  const after = last < tabs.length - 1 ? muted(' ›') : '';
  const shownTabs = tabs.slice(first, last + 1);
  const tabRow = before + shownTabs.map(tab => tab.text).join(TAB_GAP) + after;
  const underlineStart = (inline ? brandWidth + 4 : 0) + visibleWidth(before) + span(first, activeTab) - tabs[activeTab].width;
  const underlineWidth = Math.min(tabs[activeTab].width, Math.max(0, inner - underlineStart));
  // The tabs' row cannot move, so the line evens the gaps: this glyph sits a little below the middle of its row.
  const rule = '⎼';
  const underline = faint(rule.repeat(underlineStart)) + highlight(rule.repeat(underlineWidth))
    + faint(rule.repeat(Math.max(0, inner - underlineStart - underlineWidth)));
  const titleRows = inline ? [row(`${brandText}    ${tabRow}`, inlineStatus, inner)] : [row(brandText, statuses[0], inner), tabRow];
  return {
    lines: [...titleRows, underline],
    zones: tabZones(shownTabs, titleRows.length - 1, (inline ? brandWidth + 4 : 0) + visibleWidth(before)),
  };
};
const modelLabel = (effort, model, withProvider) => {
  const provider = model.lastIndexOf('/');
  const prefix = withProvider && provider > 0 ? muted(model.slice(0, provider + 1)) : '';
  return [
    effort ? effortTone(effort)(bold(clean(effort))) : '',
    model ? `${prefix}${assistantColor(model.slice(provider + 1))}` : '',
  ].filter(Boolean).join(' ');
};
const contextLabel = (context, withGauge) => {
  const percent = Number.isFinite(context?.percent)
    ? `${withGauge ? `${gauge(context.percent)} ` : ''}${dim(`${Math.round(context.percent)}%`)}` : '';
  const usage = Number.isFinite(context?.tokens)
    ? `~${tokenLabel(context.tokens)}${Number.isFinite(context.contextWindow) ? `/${tokenLabel(context.contextWindow)}` : ''}` : '';
  const details = [
    percent,
    usage ? muted(usage) : '',
    context?.auto === false ? caution('auto-compact off') : '',
    context?.compactions ? muted(`compacted ${context.compactions}`) : '',
  ].filter(Boolean);
  return details.length ? `${muted('context')}  ${details.join(spaced())}` : '';
};

const jobDetails = (run, clock) => {
  const started = timeOf(run.startedAt);
  return [
    run.harness ? dim(clean(run.harness)) : '',
    run.model ? assistantColor(clean(run.model)) : '',
    run.effort ? effortTone(run.effort)(clean(run.effort)) : '',
    started === null ? '' : muted(`started ${relativeTime(started, clock)}`),
  ].filter(Boolean).join(muted(' · '));
};
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayLabel = weekday => {
  if (weekday == null) return '';
  const days = [weekday].flat().toSorted((a, b) => a - b);
  const consecutive = days.length > 2 && days.every((day, index) => day === days[0] + index);
  return consecutive ? `${weekdays[days[0]]}–${weekdays[days.at(-1)]}` : days.map(day => weekdays[day]).join(', ');
};
const scheduleWhen = (schedule, clock) => {
  const zone = schedule.timezone ? new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone, timeZoneName: 'shortGeneric',
  }).formatToParts(clock).find(part => part.type === 'timeZoneName').value : '';
  const legacy = schedule.legacy?.legacy;
  if (legacy) return `${legacy.type} ${legacy.schedule}`;
  const times = schedule.window
    ? `${schedule.window.start}–${schedule.window.end} ${zone} · every ${every(schedule.window.everyMinutes)}`
    : `${Array.isArray(schedule.at) ? schedule.at.join(', ') : schedule.at} ${zone}`;
  return [
    schedule.cadence,
    schedule.date,
    weekdayLabel(schedule.weekday),
    schedule.day == null ? '' : `day ${schedule.day}`,
    times,
  ].filter(Boolean).join(' · ');
};
const lifecycleLabels = {
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired',
  paused: 'Paused', pending: 'Awaiting scheduler', blocked: 'Invalid routine',
};
const scheduleStatus = ({ schedule, jobs, live, clock, frame }) => {
  if (jobs.length) return { timing: 'running now', tone: positive, glyph: positive(frame) };
  if (!schedule.enabled) return { timing: 'paused', tone: caution, glyph: muted('○') };
  if (schedule.nextRun?.state === 'held') {
    return { timing: `held, retries ${until(schedule.nextRun.at, clock)}`, tone: negative, glyph: negative('✕') };
  }
  if (schedule.nextRun?.state === 'running') {
    return live
      ? { timing: 'running now', tone: positive, glyph: positive(frame) }
      : { timing: 'Activity unavailable (saved state)', tone: dim, glyph: muted('◌') };
  }
  if (schedule.nextRun?.at) return { timing: until(schedule.nextRun.at, clock), tone: accent, glyph: accent('●') };
  const { reason, state } = schedule.nextRun ?? {};
  const timing = reason ? reason.replaceAll('_', ' ') : lifecycleLabels[state] ?? '';
  if (['blocked', 'failed', 'cancelled'].includes(state)) return { timing, tone: negative, glyph: negative('✕') };
  return { timing, tone: dim, glyph: muted('◌') };
};
const scheduleLines = ({ schedules, counts, diagnostics, attention, activeRuns, live, inner, clock, frame }) => {
  const totals = [
    `${counts.daily ?? 0} daily`, `${counts.weekly ?? 0} weekly`, `${counts.monthly ?? 0} monthly`, `${counts.once ?? 0} once`,
    counts.compatibility ? `${counts.compatibility} migrated` : '',
  ].filter(Boolean).join(' · ');
  const content = [row(muted(bold('UPCOMING')), muted(totals), inner), ''];
  for (const diagnostic of diagnostics) {
    const lines = wrapped(diagnostic.title, inner - 2);
    content.push(...lines.map((value, index) => `${index ? ' ' : negative('✕')} ${warning(value)}`), '');
  }

  const hasActiveRun = schedule => activeRuns.some(run => run.scheduleId === schedule.id);
  const nextAt = schedule => schedule.enabled && schedule.nextRun?.at ? Date.parse(schedule.nextRun.at) : Infinity;
  const ordered = schedules.toSorted((left, right) =>
    Number(hasActiveRun(right)) - Number(hasActiveRun(left)) || nextAt(left) - nextAt(right) || 0);
  const items = ordered.map(schedule => {
    const jobs = activeRuns.filter(run => run.scheduleId === schedule.id);
    const when = scheduleWhen(schedule, clock);
    const { timing, tone, glyph } = scheduleStatus({ schedule, jobs, live, clock, frame });
    const unread = attention.find(item => item.ignored && item.scheduleId === schedule.id);
    return {
      jobs,
      glyph,
      tone,
      title: clean(schedule.title),
      flag: unread ? ` ${unread.read}/${unread.reports} opened` : '',
      when: clean(when),
      effort: clean(schedule.effort ?? ''),
      timing: clean(timing),
    };
  });

  // Columns take their natural widths; narrow terminals stack each schedule instead of truncating both.
  const timingWidth = Math.max(0, ...items.map(item => visibleWidth(item.timing)));
  const naturalWhen = Math.max(0, ...items.map(item => visibleWidth(item.when)));
  const naturalTitle = Math.max(0, ...items.map(item => visibleWidth(item.title + item.flag)));
  const effortWidth = Math.max(6, ...items.map(item => visibleWidth(item.effort)));
  const room = inner - 2 - timingWidth - effortWidth - 6;
  const whenWidth = Math.min(naturalWhen, Math.max(12, room - Math.min(naturalTitle, 24)));
  const titleWidth = room - whenWidth;
  const table = titleWidth >= Math.min(naturalTitle, 24) && whenWidth >= Math.min(naturalWhen, 24);
  if (table && items.length) {
    content.push(muted(`  ${cell('SCHEDULE', titleWidth)}  ${cell('WHEN', whenWidth)}  ${cell('EFFORT', effortWidth)}  ${'NEXT'.padStart(timingWidth)}`), '');
  }
  for (const item of items) {
    const heading = bold(item.title) + caution(item.flag);
    if (table) {
      const timingPadding = ' '.repeat(timingWidth - visibleWidth(item.timing));
      const effort = item.effort ? effortTone(item.effort)(item.effort) : '';
      content.push(`${item.glyph} ${cell(heading, titleWidth)}  ${cell(dim(item.when), whenWidth)}  ${cell(effort, effortWidth)}  ${timingPadding}${item.tone(item.timing)}`);
    } else {
      content.push(`${item.glyph} ${row(heading, item.tone(item.timing), inner - 2)}`);
      content.push(...wrapped(item.when, inner - 2).map(value => `  ${dim(value)}`));
    }
    for (const run of item.jobs) {
      content.push(...wrapTextWithAnsi(jobDetails(run, clock), inner - 2).map(value => `  ${value}`));
    }
    content.push('');
  }

  const scheduleIds = new Set(schedules.map(schedule => schedule.id));
  for (const run of activeRuns.filter(item => !scheduleIds.has(item.scheduleId))) {
    content.push(
      '',
      warning(`▲ Orphan scheduled job · ${clean(run.scheduleId)}`),
      `${positive(frame)} ${positive(bold(clean(run.title ?? run.id)))}`,
      ...wrapTextWithAnsi(jobDetails(run, clock), inner - 2).map(value => `  ${value}`),
    );
  }
  if (!schedules.length) content.push(dim('No routines yet. Type /setup in Chat, or add a file to routines/daily, weekly, monthly or once.'));
  return content;
};
const toolState = (state, frame) => {
  if (state === 'failed') return ['✕', negative];
  if (state === 'completed') return ['✓', positive];
  return [frame, highlight];
};
const jobActivityLines = ({ run, blocks, inner, clock, frame, markdown }) => {
  const content = [];
  if (run) {
    content.push(...wrapTextWithAnsi(`${positive(frame)} ${bold(clean(run.title ?? ''))}  ${jobDetails(run, clock)}`, inner), '');
  }
  for (const block of blocks) {
    if (block.kind === 'assistant' && clean(block.text).trim()) {
      content.push(assistantColor(bold('◆ hobkin')), ...markdown(block.text, inner - 2).map(value => `  ${value}`), '');
    } else if (block.kind === 'tool') {
      const [glyph, tone] = toolState(block.state, frame);
      content.push(`${tone(glyph)} ${bold(clean(block.name))} ${muted(clean(block.state))}`);
      if (block.input) content.push(...wrapped(block.input, inner - 2).map(value => `  ${accent(value)}`));
      if (block.output) content.push(...wrapped(block.output, inner - 2).map(value => `  ${dim(value)}`));
      content.push('');
    }
  }
  const pane = run?.work?.pane;
  const silence = pane ? `This agent runs in pane ${pane} of the Work Mode tab in Herdr. Watch it there, or press k to cancel it.`
    : 'No parent activity received yet.';
  if (!blocks.length) content.push(...wrapped(silence, inner).map(dim));
  return content;
};
// Critical, blocked and useful report messages read as messages; other notices stay quiet.
const noticeLooks = {
  critical: ['▲', caution, text => text],
  blocked: ['✕', negative, text => text],
  useful: ['●', positive, text => text],
};
// Consecutive identical report notices from the same day collapse into one entry that keeps the latest time.
const chatEntries = messages => {
  const entries = [];
  for (const message of messages) {
    const at = timeOf(message.at);
    const previous = entries.at(-1);
    const repeatsNotice = message.role === 'notice' && previous?.message.role === 'notice'
      && clean(previous.message.content) === clean(message.content) && dayOf(previous.at) === dayOf(at);
    if (repeatsNotice) {
      previous.repeats++;
      if (at !== null) previous.latest = at;
    } else {
      entries.push({ message, at, latest: at, repeats: 1 });
    }
  }
  return entries;
};
// A local message goes before the first thing newer than it, and everything else keeps its order.
const placeByTime = (messages, message) => {
  const firstNewer = messages.findIndex(other => timeOf(other.at) > timeOf(message.at));
  return firstNewer < 0 ? [...messages, message] : messages.toSpliced(firstNewer, 0, message);
};
const authorLabel = message => {
  if (message.waiting) return muted(bold('◆ You'));
  if (message.role === 'user') return accent(bold('◆ You'));
  if (message.role === 'assistant') return assistantColor(bold('◆ hobkin'));
  return muted(bold(`◇ ${clean(message.role)}`));
};
const messageLines = ({ message, at, latest, repeats }, inner, markdown) => {
  const time = at === null ? '' : muted(clockTime(at));
  if (message.role === 'notice') {
    const label = `${clean(message.content)}${repeats > 1 ? ` ×${repeats}` : ''}`;
    const latestTime = latest === null ? '' : muted(clockTime(latest));
    const [glyph, paintGlyph, paintText] = noticeLooks[message.tone] ?? ['◇', muted, dim];
    const lines = wrapped(label, inner - 9).map((value, part) =>
      part ? `  ${paintText(value)}` : `${paintGlyph(glyph)} ${row(paintText(value), latestTime, inner - 2)}`);
    return [...lines, ''];
  }
  const about = message.about ? [`  ${muted(`↳ ${clean(message.about)}`)}`] : [];
  // Markdown paints its own colors, so a waiting message stays plain to read as one gray block.
  const body = message.waiting
    ? wrapped(message.content, inner - 2).map(value => `  ${dim(value)}`)
    : markdown(message.content, inner - 2).map(value => `  ${value}`);
  return [row(authorLabel(message), time, inner), ...about, ...body, ''];
};
// A message's rows depend on these and nothing else, so an entry keeps its rows for as long as its key holds.
const entryKey = ({ message, latest, repeats }, inner) => [
  inner, message.role, message.tone, message.waiting, message.about, message.at, latest, repeats, message.content,
].join('\0');
const chatLines = ({ messages, inner, clock, rowsOf }) => {
  const entries = chatEntries(messages);
  const content = [];
  const days = [];
  const marks = [];
  let day;
  entries.forEach((entry, index) => {
    const { at } = entry;
    const startsDay = !index || (at !== null && dayOf(at) !== day);
    if (startsDay) {
      day = dayOf(at);
      if (index) content.push('');
      const label = dayHeading(at, clock);
      const heading = row(label, muted(count(entries.length, 'message')), inner);
      days.push({ line: content.length, heading });
      content.push(index ? label : heading, '');
    }
    const key = entryKey(entry, inner);
    content.push(...rowsOf(key, entry));
    marks.push({ key, end: content.length });
  });
  return { content, days, marks };
};
const welcomeLines = (inner, available, isNew) => {
  const welcome = [
    `${highlight('◆')}  ${bold('What would you like to work on?')}`,
    '',
    ...wrapped('Message your agent below. Reports from scheduled checks appear in Reports.', Math.min(inner, 64)).map(dim),
    ...(isNew ? wrapped('New here? Type /setup and hobkin walks you through it.', Math.min(inner, 64)).map(dim) : []),
    '',
    keys([['←→', 'switch views'], ['/help', 'what hobkin can do'], ['/setup', 'get ready']]),
  ];
  const topPadding = Math.max(0, Math.floor((available - welcome.length) / 2));
  return [...Array(topPadding).fill(''), ...welcome.map(value => centered(value, inner))];
};
const reportListLines = ({ reports, total, selectedId, filtered, inner, clock }) => {
  const content = [];
  const ranges = [];
  let day;
  reports.forEach((report, index) => {
    const at = timeOf(report.at);
    const startsDay = !index || dayOf(at) !== day;
    // One blank line separates reports; days get a wider gap so the grouping reads at a glance.
    if (index) content.push('');
    if (startsDay) {
      day = dayOf(at);
      if (index) content.push('');
    }
    const start = content.length;
    if (startsDay) {
      const label = dayHeading(at, clock);
      const shown = reports.length < total ? `latest ${reports.length} of ${total}` : count(reports.length, 'report');
      content.push(index ? label : row(label, muted(shown), inner), '');
    }
    const isSelected = report.id === selectedId;
    const title = clean(report.title);
    const summary = summaryOf(report);
    const lines = [`${reportMark(report)} ${row(isSelected ? highlight(bold(title)) : title, dim(at === null ? '' : clockTime(at)), inner - 2)}`];
    if (summary) lines.push(`  ${dim(summary)}`);
    content.push(...lines.map(value => (isSelected ? selectedRow(value, inner) : value)));
    ranges.push([start, content.length]);
  });
  if (!reports.length) content.push(dim(filtered ? 'No report titles match.' : 'No reports yet.'));
  return { content, ranges };
};
const prWords = { off: 'no PRs', draft: 'draft PRs', published: 'PRs' };
const projectStatus = ({ prMode, open, prs, branches, left, unmerged, nextLookAt }, clock) => {
  const facts = [
    open ? count(open, 'item') : '',
    prs ? count(prs, 'PR') : '',
    branches ? `${branches} ${branches === 1 ? 'branch' : 'branches'}` : '',
    left ? `${left} left for you` : '',
    unmerged ? `${unmerged} unmerged` : '',
    nextLookAt ? `next look ${until(nextLookAt, clock)}` : '',
  ].filter(Boolean);
  return [prWords[prMode], ...(facts.length ? facts : ['not looked at yet'])].filter(Boolean).join(' · ');
};
const stoppedLine = running => {
  const kept = 'Projects, items and branches stay.';
  if (!running) return `Nothing new starts. ${kept}`;

  const finishing = running === 1 ? 'The running agent finishes what it started' : `The ${running} running agents finish what they started`;
  return `${finishing}, and nothing new starts. ${kept}`;
};
const lastLookLine = ({ status, reason, offered }) => {
  if (status === 'failed') return `The last look failed: ${clean(reason)}`;
  if (status === 'unfinished') return `The last look stopped early: ${clean(reason)}`;
  if (status === 'cancelled') return 'The last look was cancelled.';
  return status === 'finished' && !offered ? `The last look proposed nothing: ${clean(reason)}` : '';
};
const upcomingLook = (work, clock) => {
  const projects = (work.projects ?? []).filter(project => project.state === 'chosen');
  const looks = [
    { at: work.nextDiscoveryAt, name: shortPath(work.folder) },
    ...projects.map(project => ({ at: project.nextLookAt, name: clean(project.name ?? project.slug) })),
  ];
  return looks.filter(look => timeOf(look.at) > clock).toSorted((left, right) => timeOf(left.at) - timeOf(right.at))[0];
};
const foldersDone = discovery => {
  const left = foldersLeft(discovery);
  if (!left) return '';

  const total = discovery.rootFolders.length;
  return ` (${total - left.length} of ${total} folders done)`;
};
// A queue with work in it is what happens next, and a look hours away says nothing about that.
const nextInQueue = ({ plan = [], nextStartAt, autoPick, paused }, clock) => {
  if (paused || autoPick === false) return '';
  const rows = plan.filter(entry => !entry.skipped);
  const ready = rows.find(entry => !entry.waiting);
  const top = ready ?? rows.find(entry => entry.waiting === 'a free worker');
  if (!top) return '';
  const name = `${clean(top.project)}: ${clean(top.title)}`;
  if (!ready) return `${name} starts when a worker is free.`;
  return `${name} starts ${nextStartAt ? until(nextStartAt, clock) : 'now'}.`;
};
// The tab always answers these two questions, so it can never be an empty page that looks broken.
const workSituation = ({ work, runs, clock }) => {
  const { discovery = {}, folder, projects = [], paused } = work;
  const where = folder ? shortPath(folder) : '';
  const waiting = projects.filter(project => project.state === 'proposed').length;
  const answers = waiting ? ` ${waiting === 1 ? '1 proposal is' : `${waiting} proposals are`} waiting for an answer.` : '';
  const look = upcomingLook(work, clock);
  const scheduled = look ? `A look at ${look.name} at ${lookTime(look.at, clock)} (${until(look.at, clock)}).` : '';
  if (work.discovering) {
    const others = runs.filter(run => run.work?.lane !== 'discover').length;
    return {
      now: `Looking through ${where}${foldersDone(discovery)}.${others ? ` ${count(others, 'other agent')} running.` : ''}${answers}`,
      next: 'It asks in Chat which projects to take when it finishes.',
      scheduled,
    };
  }
  const running = runs.length ? `${count(runs.length, 'agent')} running.` : 'Nothing is running.';
  const lookNow = paused ? 'It looks again once the pause ends.' : `It looks${where ? ` in ${where}` : ''} now.`;
  const dueNow = discovery.status === 'finished' ? 'New repositories are proposed as they appear.' : lookNow;
  const coming = nextInQueue(work, clock);
  return {
    now: [paused ? `Paused. ${running}` : running, lastLookLine(discovery)].filter(Boolean).join(' ') + answers,
    next: coming || (scheduled ? '' : dueNow),
    scheduled: coming ? '' : scheduled,
  };
};
const foundLine = names => {
  const latest = names.slice(-MAX_REPOSITORIES_SHOWN).map(clean).join(', ');
  const amount = names.length === 1 ? '1 repository' : `${names.length} repositories`;
  return `Found ${amount}: ${names.length > MAX_REPOSITORIES_SHOWN ? 'latest ' : ''}${latest}`;
};
// The agent's report says what it means to do. This says what it just did, so the tab moves even if it never reports.
const latestStep = blocks => {
  const block = blocks?.findLast(entry => entry.kind === 'tool' && !/ work (?:progress|propose) /.test(entry.input ?? ''));
  if (!block) return '';
  let detail = block.input ?? '';
  try {
    const input = JSON.parse(detail);
    detail = input?.command ?? input?.path ?? detail;
  } catch {
    // Not every tool's input is JSON, and the text says enough.
  }
  return clean(`${block.name} ${detail}`);
};
const discoveryLines = ({ work, step, inner, clock, frame }) => {
  const { discovery = {}, projects = [] } = work;
  const proposed = projects.filter(project => project.state === 'proposed').length;
  const started = timeOf(discovery.startedAt);
  const summary = [`${proposed} proposed so far`, started === null ? '' : elapsed(started, clock)].filter(Boolean).join(' · ');
  const place = discovery.current ? `Going through ${shortPath(discovery.current)}` : '';
  const going = [place, discovery.doing].filter(Boolean).join(': ');
  const found = discovery.repositories?.length ? foundLine(discovery.repositories) : '';
  const indented = (text, paint) => wrapped(text, inner - 2).map(value => `  ${paint(value)}`);
  return [
    muted(bold('FINDING PROJECTS')),
    '',
    `${highlight(frame)} ${dim(summary)}`,
    ...(going ? indented(going, dim) : []),
    ...(found ? indented(found, muted) : []),
    ...(step ? [`  ${muted(`Last step: ${step}`)}`] : []),
    '',
  ];
};
const MOST_QUEUE_ROWS = 8;
const gradeTone = { P0: negative, P1: caution, P2: dim, P3: muted };
const gradeLabel = grade => (gradeTone[grade] ?? muted)(clean(grade ?? ''));
const nextIn = (list, value) => list[(list.indexOf(value) + 1) % list.length];
const isP0 = entry => entry.grade === 'P0';
// Every P0 stays in sight, and the rest fill what room is left.
const rowsInSight = waitingRows => {
  const room = Math.max(0, MOST_QUEUE_ROWS - waitingRows.filter(isP0).length);
  const others = waitingRows.filter(entry => !isP0(entry)).slice(0, room);
  return waitingRows.filter(entry => isP0(entry) || others.includes(entry));
};
// Each row says what it is and, in a few words, why it is here or what it waits for. Skipped rows stay in sight so they can be put back.
const queueRows = ({ plan = [], queued = 0 }, inner) => {
  const shown = rowsInSight(plan.filter(entry => !entry.skipped));
  const rows = [...shown, ...plan.filter(entry => entry.skipped)].map(entry => {
    const cost = entry.estimate?.fresh ? ` · ~${tokenLabel(entry.estimate.fresh)}` : '';
    const said = entry.skipped ? 'skipped' : entry.waiting ? `waiting: ${entry.waiting}` : entry.why;
    const words = line(clean(said), Math.max(8, Math.floor(inner / 2) - cost.length));
    return {
      key: `queue:${entry.key}`,
      type: 'queue',
      queueKey: entry.key,
      slug: entry.slug,
      id: entry.item,
      grade: entry.grade,
      skipped: entry.skipped,
      lines: [row(`${gradeLabel(entry.grade)}  ${clean(entry.project)}: ${clean(entry.title)}`, (entry.waiting ? caution : dim)(`${words}${cost}`), inner)],
    };
  });
  const more = queued - shown.length;
  return more > 0 ? [...rows, { lines: [muted(`    and ${more} more`)] }] : rows;
};
const queueTally = ({ plan = [], queued = 0, allowanceRequest }) => {
  const urgent = plan.filter(entry => isP0(entry) && !entry.skipped).length + (allowanceRequest ? 1 : 0);
  return `${urgent ? `${urgent} P0 · ` : ''}${queued} queued`;
};
// What git can say about a branch. Nothing is shown when it could not say, because unknown is not ready.
const mergeState = ({ conflict, behind }) => {
  if (conflict) return caution('needs a rebase');
  if (conflict === false) return positive(behind ? `ready to merge · ${behind} behind` : 'ready to merge');
  return '';
};
const MOST_DONE_ROWS = 5;
const safetyTone = { safe: positive, medium: caution, risky: negative };
// A grade is only as good as the commit it read, so one from further back looks like what it is.
const safetyWords = ({ safety }) => {
  if (!safety) return muted('not graded');
  const { grade, rating, stale } = safety;
  if (stale) return dim(`${clean(grade)} ${clean(rating)} on an older commit`);
  return (safetyTone[grade] ?? dim)(`${clean(grade)} ${clean(rating)}`);
};
const qualityWords = ({ quality }) => {
  if (!quality) return '';
  const { rating, stale } = quality;
  return dim(stale ? `quality ${clean(rating)} on an older commit` : `quality ${clean(rating)}`);
};
const sizeWords = ({ size }) => {
  if (!size) return '';
  const changed = size.additions + size.deletions;
  return `${changed} ${changed === 1 ? 'line' : 'lines'} · ${count(size.files, 'file')}`;
};
const landedFacts = entry => {
  const { holds, onlyDocs, described, proved } = entry;
  const facts = [
    sizeWords(entry) && dim(sizeWords(entry)),
    onlyDocs && dim('docs only'),
    holds && dim(`holds ${holds} earlier ${holds === 1 ? 'branch' : 'branches'}`),
    described === false && caution('no description'),
    proved === false && caution('no proof'),
  ];
  return [safetyWords(entry), qualityWords(entry), mergeState(entry), ...facts].filter(Boolean).join(muted(' · '));
};
const doneRow = (entry, type, facts) => {
  const { slug, project, item, title } = entry;
  return {
    key: `${type}:${slug}:${item}`,
    type,
    slug,
    id: item,
    title,
    risky: entry.safety?.grade === 'risky' && !entry.safety.stale,
    lines: [`${positive('●')} ${clean(project)}: ${clean(title)}`, `  ${facts}`],
  };
};
const closingRow = ({ project, title, doing }, inner) => ({
  lines: [row(`${muted('◐')} ${clean(project)}: ${clean(title)}`, dim(clean(doing)), inner)],
});
// Five at a time, so the list reads as a short job. Each row answered brings up the next.
const landRows = rows => {
  const shown = rows.slice(0, MOST_DONE_ROWS).map(entry => doneRow(entry, 'ready', landedFacts(entry)));
  const more = rows.length - shown.length;
  return more > 0 ? [...shown, { lines: [muted(`  and ${more} more`)] }] : shown;
};
const inGaps = (ready, ...gaps) => ready.filter(({ gap = 'land' }) => gaps.includes(gap));
const doneCount = ({ ready = [] }) => inGaps(ready, 'land', 'rebase', 'yours', 'elsewhere').length;
const doneSections = ({ work: { ready = [], closing = [] }, inner }) => {
  const land = inGaps(ready, 'land', 'rebase');
  const sections = [
    ['NEXT TO LAND', landRows(land), null, String(land.length)],
    ['AGENT ON IT', closing.map(entry => closingRow(entry, inner))],
    ['YOUR TURN', inGaps(ready, 'yours').map(entry => doneRow(entry, 'yours', dim(clean(entry.summary ?? 'Only you can do this one.'))))],
    ['ALREADY ELSEWHERE', inGaps(ready, 'elsewhere').map(entry => doneRow(entry, 'elsewhere', dim(`also on ${clean(entry.landedOn)}`)))],
  ];
  return sections.filter(([, rows]) => rows.length);
};
const doneReading = ({ entry, description, inner }) => {
  const { project, title, safety, quality, notices, left, summary } = entry;
  const grounds = [safety?.reason && `Why: ${safety.reason}`, quality?.reason && `Quality: ${quality.reason}`, notices && `Who notices: ${notices}`];
  const reason = grounds.filter(Boolean).flatMap(text => wrapped(text, inner)).map(dim);
  const leftFor = left ? ['', ...wrapped(`Left for you: ${left}`, inner).map(caution)] : [];
  const said = description ?? summary ?? 'This branch has no description yet.';
  return {
    content: [
      ...wrapped(`${clean(project)}: ${clean(title)}`, inner).map(bold),
      landedFacts(entry),
      ...reason,
      ...leftFor,
      '',
      ...cleanLines(said).split('\n').flatMap(value => wrapped(value, inner)),
    ],
  };
};
// The rows the user can act on, grouped as they appear. A row's key keeps it selected across refreshes.
const workSections = ({ work, runs, inner, clock, frame }) => {
  const named = project => clean(project.name ?? project.slug);
  // The sort is stable, so projects of one priority stay in the order they came in.
  const projects = (work.projects ?? []).filter(project => project.state === 'chosen').toSorted(byPriority);
  const proposed = (work.projects ?? []).filter(project => project.state === 'proposed').toSorted(byRank);
  const nameWidth = Math.min(24, Math.max(0, ...projects.map(project => visibleWidth(named(project)))));
  const asked = work.allowanceRequest;
  const allowance = asked ? [{
    key: 'allowance',
    type: 'allowance',
    lines: [
      `${gradeLabel('P0')}  ${bold(`Raise today's tokens to ${tokenLabel(asked.proposed)}?`)}`,
      ...wrapped(asked.reason, inner - 4).map(value => `    ${dim(value)}`),
    ],
  }] : [];
  const sections = [
    ['RUNNING', runs.map(run => ({
      key: `run:${run.id}`,
      type: 'run',
      id: run.id,
      lines: [
        `${positive(frame)} ${row(clean(run.title), dim(`${clean(run.effort)} · ${elapsed(Date.parse(run.startedAt), clock)}`), inner - 2)}`,
        ...wrapped((work.running ?? []).find(({ id }) => id === run.id)?.note ?? '', inner - 2).filter(Boolean).map(value => `  ${muted(value)}`),
      ],
    }))],
    ['QUEUE', [...allowance, ...queueRows(work, inner)], null, queueTally(work)],
    ['PROJECTS', projects.map(project => ({
      key: `project:${project.slug}`,
      type: 'project',
      slug: project.slug,
      name: named(project),
      priority: project.priority,
      prMode: project.prMode,
      lines: [
        `${positive('●')} ${cell(bold(named(project)), nameWidth)}  ${cell(gradeLabel(project.priority), 2)}  ${cell(dim(project.level), 9)}  ${muted(projectStatus(project, clock))}`,
        ...(project.lookError ? wrapped(`Last look failed: ${project.lookError}`, inner - 2).map(value => `  ${negative(value)}`) : []),
        ...(project.folderNote ? wrapped(`Its folder: ${project.folderNote}`, inner - 2).map(value => `  ${caution(value)}`) : []),
      ],
    }))],
    ['PROPOSED', proposed.map(project => ({
      key: `proposal:${project.slug}`,
      type: 'proposal',
      slug: project.slug,
      lines: [
        `${muted('◇')} ${row(bold(named(project)), dim(project.level), inner - 2)}`,
        ...[project.summary, project.found, project.reason].filter(Boolean).flatMap(text => wrapped(text, inner - 2)).map(value => `  ${dim(value)}`),
        ...(project.first?.[0] ? [`  ${muted(`First: ${clean(project.first[0].title)}`)}`] : []),
      ],
    })), keys([['y', 'take'], ['1', 'critical'], ['2', 'important'], ['3', 'casual'], ['4', 'max'], ['n', 'skip']])],
  ];
  return sections.filter(([, rows]) => rows.length);
};
const workCircle = work => (work.paused ? caution('●') : positive('●'));
const budgetLine = ({ dailyTokens, tokensToday = 0, hourShare, tokensThisHour = 0 }) => {
  if (!dailyTokens) return '';
  const left = Math.max(0, dailyTokens - tokensToday);
  const hour = hourShare ? ` This hour: ${tokenLabel(tokensThisHour)} of ${tokenLabel(hourShare)}.` : '';
  return `Today: ${tokenLabel(tokensToday)} used, ${tokenLabel(left)} left.${hour}`;
};
const subscriptionLine = ({ subscription, harness }) => {
  if (harness === 'claude') return 'claude panes count when each run ends, from Claude\'s own files, and run one at a time.';
  if (harness && harness !== 'pi') return `${clean(harness)} panes cannot be measured: each counts as its estimate, one at a time.`;
  if (!subscription) return '';
  if (!subscription.known) return 'Subscription: not known yet, so one agent runs at a time.';
  const windows = subscription.windows.map(({ label, usedPercent }) => `${clean(label)} ${Math.round(usedPercent)}% used`).join(', ');
  return windows ? `Subscription: ${windows}.` : '';
};
const watchLine = ({ watch }, clock) => {
  if (!watch?.at) return '';
  const when = new Date(watch.at);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const day = when.toDateString() === new Date(clock).toDateString() ? 'today' : 'yesterday';
  const news = [watch.proposed && `${watch.proposed} new`, watch.changed && `${watch.changed} changed`, watch.removed && `${watch.removed} gone`].filter(Boolean).join(', ');
  return `Last watch: ${time} ${day}${news ? `, ${news}` : ''}.`;
};
const startLine = ({ waitingOn, autoPick }) => {
  if (waitingOn) return waitingOn;
  return autoPick === false ? 'Auto-pick is off: only what is picked in the queue runs.' : '';
};
const maxLine = ({ maxRuns, projects = [] }) => {
  const inUse = maxRuns && (maxRuns.running || maxRuns.today || projects.some(project => project.state === 'chosen' && project.level === 'max'));
  return inUse ? `Max: ${maxRuns.running} of ${maxRuns.atOnce} running, ${maxRuns.today} of ${maxRuns.perDay} today. Claude's tokens count when each run ends.` : '';
};
/** Adds each section to `content`, and returns where the selected row landed. */
const decisionRow = ({ tldr, from, question, choices, at }, isSelected, inner, clock) => {
  const when = timeOf(at) === null ? '' : ` · ${elapsed(timeOf(at), clock)}`;
  const heading = row(`${highlight('●')} ${bold(clean(tldr))}`, dim(`${clean(from)}${when}`), inner);
  if (!isSelected) return [heading];
  const asked = clean(question) === clean(tldr) ? [] : wrapped(question, inner - 2).map(value => `  ${dim(value)}`);
  return [selectedRow(heading, inner), ...asked, ...choices.map(({ label }, index) => `  ${accent(String(index + 1))} ${clean(label)}`)];
};
const decisionLines = ({ decisions, selected, inner, clock }) => ({
  content: decisions.flatMap(decision => [...decisionRow(decision, decision === selected, inner, clock), '']),
});
const pushSections = (content, { sections, selected, inner }) => {
  let selectedRange;
  for (const [heading, rows, note, tally] of sections) {
    content.push(row(muted(bold(heading)), muted(tally ?? String(rows.length)), inner), '');
    if (note) content.push(note, '');
    rows.forEach((item, index) => {
      const isSelected = Boolean(item.key) && item.key === selected?.key;
      if (isSelected) selectedRange = [content.length, content.length + item.lines.length];
      content.push(...item.lines.map(value => (isSelected ? selectedRow(value, inner) : value)));
      // Rows of several lines would otherwise run together.
      if (item.lines.length > 1 && index < rows.length - 1) content.push('');
    });
    content.push('');
  }
  return selectedRange;
};
const workLines = ({ work, runs, sections, selected, step, inner, clock, frame }) => {
  const state = `${workCircle(work)} ${dim(work.paused ? 'paused' : 'active')}`;
  const atLimit = work.dailyTokens && work.tokensToday >= work.dailyTokens;
  const tokens = work.dailyTokens ? `${tokenLabel(work.tokensToday ?? 0)}/${tokenLabel(work.dailyTokens)} tokens` : '';
  const agents = work.agents ? `${runs.length}/${work.agents} agents` : '';
  const queued = work.queued ? `${work.queued} queued` : '';
  const cached = work.tokensCached ? `${tokenLabel(work.tokensCached)} cached` : '';
  const status = [state, work.harness ? dim(clean(work.harness)) : '', dim(agents), dim(queued), tokens ? (atLimit ? caution : dim)(tokens) : '', dim(cached)]
    .filter(text => stripTerminalSequences(text)).join(muted(' · '));
  const { now, next, scheduled } = workSituation({ work, runs, clock });
  const where = work.folder ? `, starting from ${shortPath(work.folder)}` : '';
  const facts = [budgetLine(work), subscriptionLine(work), maxLine(work), watchLine(work, clock), startLine(work)].filter(Boolean);
  const content = [
    row(muted(bold('WORK MODE')), status, inner),
    '',
    ...wrapped(`Work mode is on${where}. Type /work in Chat to stop.`, inner).map(bold),
    ...wrapped(`Now: ${now}`, inner).map(dim),
    ...wrapped(`Next: ${[next, scheduled].filter(Boolean).join(' ')}`, inner).map(dim),
    ...facts.flatMap(fact => wrapped(fact, inner)).map(dim),
    '',
  ];
  if (work.pause) content.push(...wrapped(work.pause.line, inner).map(caution), '');
  if (work.discovering) content.push(...discoveryLines({ work, step, inner, clock, frame }));
  return { content, selectedRange: pushSections(content, { sections, selected, inner }) };
};
const doneLines = ({ sections, selected, inner }) => {
  if (!sections.length) return { content: [dim('Nothing is waiting. Finished work lands here for you to walk through.')] };
  const content = [];
  return { content, selectedRange: pushSections(content, { sections, selected, inner }) };
};
const reportDetailLines = ({ report, inner, clock, markdown }) => {
  if (!report) return [dim('No report selected.')];
  const [glyph, tone] = outcome(report.outcome);
  const when = timestamp(report.at, clock);
  const meta = [
    report.outcome ? tone(`${glyph} ${clean(report.outcome).replaceAll('_', ' ')}`) : '',
    when ? dim(when) : '',
  ].filter(Boolean).join(muted(' · '));
  const provenance = report.origin ? [
    ...wrapped([report.readState, report.provider ? `provider ${report.provider}` : '', report.origin].filter(Boolean).join(' · '), inner).map(muted),
    ...wrapped(`Source: ${report.path}${report.truncated ? ' (preview truncated)' : ''}`, inner),
  ] : [];
  return [
    ...wrapped(report.title, inner).map(bold),
    ...(meta ? wrapTextWithAnsi(meta, inner) : []),
    ...provenance,
    faint('─'.repeat(inner)),
    '',
    ...markdown(report.body, inner),
  ];
};
// A selected row's bar sits in the margin, so its glyph stays in line with every other row.
const viewport = ({ content, offset, available, inner }) => {
  const visible = content.slice(offset, offset + available);
  return Array.from({ length: available }, (_, index) => {
    const value = visible[index] ?? '';
    const margin = value.startsWith(palette.selection) ? ` ${highlight('▌')}` : '  ';
    return `${margin}${line(value, inner)}`;
  });
};

// The dashboard draws the composer's rules; the editor only reports how many lines are scrolled away.
class Composer extends Editor {
  renderTopBorder(_width, hidden) { return hidden > 0 ? `↑ ${hidden} more` : ''; }
  renderBottomBorder(_width, hidden) { return hidden > 0 ? `↓ ${hidden} more` : ''; }
}

export function createDashboard(initial, handlers = {}, options = {}) {
  let snapshot = initial;
  let callbacks = handlers;
  let selectedId = snapshot.reports?.[0]?.id ?? null;
  let completedReport = null;
  let reportKind = reportKinds[0].name;
  const reportFilter = new Input({ prompt: '' });
  let typingFilter = false;
  let focus = 'composer';
  let view = 'conversation';
  let scroll = 0;
  let listTop = 0;
  let rows = 24;
  let columns = 80;
  let contentBounds = { top: 0, bottom: 0 };
  let clickableTabs = [];
  let hasFocus = true;
  let question = null;
  let notice = '';
  let noticeTone = 'info';
  let noticeTimer = null;
  let busySince = null;
  let ticker = null;
  let tickerMs = 0;
  let faceShown = false;
  const motion = options.motion ? new Slide() : null;
  let reading = null;
  let referencedReport = null;
  let workKey = null;
  let armedDrop = null;
  let armedMax = null;
  let askingWorkFolder = false;
  let workTab = 'now';
  let donePage = null;
  let notingOn = null;
  let armedMerge = null;
  let decisionId = null;
  let setupWaiting = false;
  let hiddenMessages = new Set(snapshot.presentation?.hiddenMessageIds ?? []);
  const messageKey = message => message.id ?? JSON.stringify(message);
  // What the user sent that the conversation does not show yet, oldest first.
  let outbox = [];
  const delivered = new Set();
  // A message leaves when the conversation shows it, or when a turn ends without it, as one an extension handled does.
  const settleOutbox = () => {
    const isCopyOf = (message, entry) => message.role === 'user' && !delivered.has(messageKey(message))
      && timeOf(message.at) >= timeOf(entry.at);
    outbox = outbox.filter(entry => {
      const copy = (snapshot.messages ?? []).find(message => isCopyOf(message, entry));
      if (copy) delivered.add(messageKey(copy));
      return !copy && !(entry.accepted && !snapshot.busy);
    });
  };
  // What hobkin says in Chat by itself. It never reaches the agent and goes when hobkin closes.
  const localMessages = [];
  const isVisible = message => !hiddenMessages.has(messageKey(message)) && clean(message.content).trim();
  const visibleMessageIds = () => [...(snapshot.messages ?? []), ...localMessages].filter(isVisible).map(messageKey);
  let pending = Promise.resolve();
  let clearing = false;
  let stopped = false;
  const onChange = options.onChange ?? (() => {});
  const now = () => (options.now ?? Date.now)();
  const startedAt = now();
  // A newer notice always cancels a pending timeout, so it never erases what replaced it.
  const say = (text, tone = 'info', { timeout } = {}) => {
    notice = text;
    noticeTone = tone;
    clearTimeout(noticeTimer);
    noticeTimer = null;
    if (!timeout) return;

    noticeTimer = setTimeout(() => {
      say('');
      changed();
    }, timeout);
    noticeTimer.unref?.();
  };
  const allReports = () => snapshot.reports ?? [];
  const filterText = () => reportFilter.getValue().trim().toLowerCase();
  const reportsOfKind = kind => {
    const searchText = filterText();
    return allReports().filter(report => (kind === 'all' || reportKindOf(report) === kind)
      && clean(report.title).toLowerCase().includes(searchText));
  };
  const reports = () => reportsOfKind(reportKind).slice(0, 25);
  const liveJobs = () => snapshot.connection === 'connected' ? (snapshot.runs ?? []).filter(run =>
    run.state === 'running' && run.kind === 'background' && !run.work
    && typeof run.scheduleId === 'string' && run.scheduleId.trim()) : [];
  const workRuns = () => (snapshot.connection === 'connected' ? (snapshot.runs ?? []).filter(run => run.state === 'running' && run.work) : []);
  const workVisible = () => Boolean(snapshot.work?.enabled);
  const invalidSchedules = () => (snapshot.runs ?? []).filter(run => run.state === 'invalid');
  const decisions = () => snapshot.decisions ?? [];
  const views = () => ['conversation', 'reports', 'schedules', ...(decisions().length ? ['decisions'] : []), ...(workVisible() ? ['work'] : []), ...liveJobs().map(run => `job:${run.id}`)];
  const jobViews = () => [...liveJobs(), ...workRuns()].map(run => `job:${run.id}`);
  const images = options.images ?? null;
  const faceColumns = () => (images ? IMAGE_FACE_COLUMNS : FACE_COLUMNS);
  const faceFrameMs = mood => {
    if (images) return images.frameMs(mood);
    return ['idle', 'sleepy'].includes(mood) ? RESTING_FACE_MS : MOVING_FACE_MS;
  };
  const moodNow = clock => currentMood({
    reaction: snapshot.mood,
    busy: snapshot.connection === 'connected' && snapshot.busy,
    running: jobViews().length || snapshot.work?.discovering,
    typing: Boolean(editor.getExpandedText()),
    now: clock,
  });
  const currentWorkSections = (inner, clock, frame) => {
    const work = snapshot.work ?? {};
    return workTab === 'done' ? doneSections({ work, inner }) : workSections({ work, runs: workRuns(), inner, clock, frame });
  };
  const selectedWorkRow = (sections = currentWorkSections(columns - 4, now(), '')) => {
    const rows = sections.flatMap(([, entries]) => entries).filter(entry => entry.key);
    const answerable = rows.find(entry => answerableRows.includes(entry.type));
    return rows.find(entry => entry.key === workKey) ?? answerable ?? rows[0] ?? null;
  };
  const selectedDecision = () => decisions().find(({ id }) => id === decisionId) ?? decisions()[0] ?? null;
  const isJob = () => view.startsWith('job:');
  const followsTail = () => view === 'conversation' || isJob();
  const isReportListFocus = value => value === 'reports' || value === 'reportTabs';
  const showsReportList = () => view === 'reports' && isReportListFocus(question?.previous.focus ?? focus);
  const selectedIndex = () => Math.max(0, reports().findIndex(report => report.id === selectedId));
  const keepSelectionListed = () => {
    if (!completedReport && !reports().some(report => report.id === selectedId)) selectedId = reports()[0]?.id ?? null;
  };
  const moveReportSelection = delta => {
    const list = reports();
    completedReport = null;
    selectedId = list[Math.max(0, Math.min(list.length - 1, selectedIndex() + delta))]?.id ?? null;
    scroll = 0;
  };
  const clearFilter = () => {
    reportFilter.setValue('');
    typingFilter = false;
    keepSelectionListed();
  };
  const showReportKind = kind => {
    reportKind = kind;
    keepSelectionListed();
    scroll = 0;
  };
  const stepReportKind = delta => {
    const index = reportKinds.findIndex(({ name }) => name === reportKind);
    const next = (index + delta + reportKinds.length) % reportKinds.length;
    showReportKind(reportKinds[next].name);
  };
  const startFilter = () => {
    focus = 'reports';
    typingFilter = true;
  };
  const reportOnScreen = () => {
    if (view !== 'reports' || focus !== 'detail') return null;
    return completedReport ?? reports()[selectedIndex()] ?? null;
  };
  // Every state change passes through here, so each way of leaving a report ends the same timer.
  const trackReading = report => {
    if (reading?.id === report?.id) return;
    if (reading) callbacks.reportRead?.({ id: reading.id, dwellMs: now() - reading.since });
    reading = report ? { id: report.id, since: now() } : null;
  };
  const changed = () => {
    if (stopped) return;
    trackReading(reportOnScreen());
    animate();
    onChange();
  };
  const connected = () => snapshot.connection === 'connected' && typeof callbacks.send === 'function';
  // Spinners and elapsed time only need frames while the main turn, compaction or a job is running.
  const animate = () => {
    const live = snapshot.connection === 'connected';
    busySince = live && snapshot.busy ? busySince ?? now() : null;
    const active = !stopped && live && Boolean(snapshot.busy || snapshot.context?.compacting || jobViews().length || snapshot.work?.discovering);
    const faceMs = faceShown && !stopped ? faceFrameMs(moodNow(now())) : 0;
    const resting = active ? Math.min(ACTIVE_FRAME_MS, faceMs || ACTIVE_FRAME_MS) : faceMs;
    const wanted = motion?.moving && !stopped ? Math.min(FRAME_MS, resting || FRAME_MS) : resting;
    if (wanted === tickerMs) return;
    clearInterval(ticker);
    ticker = wanted ? setInterval(changed, wanted) : null;
    ticker?.unref?.();
    tickerMs = wanted;
  };

  // Tips and the next-check countdown change with no event to redraw them.
  const idleRedraw = setInterval(changed, IDLE_REDRAW_MS);
  idleRedraw.unref?.();

  const editor = new Composer(options.tui ?? {
    terminal: { get rows() { return rows; } },
    requestRender: changed,
  }, { borderColor: accent, selectList: selectTheme });
  editor.onChange = changed;
  for (const message of snapshot.messages ?? []) {
    if (message.role === 'user') editor.addToHistory(message.content);
  }
  const needsWorkFolder = () => !snapshot.work?.enabled && !snapshot.work?.folder;
  const askForWorkFolder = () => {
    askingWorkFolder = true;
    focus = 'composer';
    say('');
  };
  // The notice row is short beside the face, so what stopped and what stays goes in the conversation.
  const announceWork = enabled => {
    const { now: happening, next, scheduled } = workSituation({ work: snapshot.work ?? {}, runs: workRuns(), clock: now() });
    localMessages.push({
      id: `work:${randomUUID()}`,
      role: 'assistant',
      content: enabled ? `Work mode on. ${happening} ${next || scheduled}` : `Work mode off. ${stoppedLine(workRuns().length)}`,
      at: new Date(now()).toISOString(),
    });
  };
  const startWorkIn = folder => {
    clearing = true;
    pending = Promise.resolve().then(() => {
      if (typeof callbacks.workAction !== 'function') throw Error('Work mode unavailable');
      return callbacks.workAction('start', folder);
    }).then(() => {
      editor.setText('');
      askingWorkFolder = false;
      announceWork(true);
    }, error => { say(`Work mode failed: ${clean(error?.message ?? error)}`, 'error'); })
      .finally(() => { clearing = false; changed(); });
  };
  const toggleWorkFromChat = submitted => {
    clearing = true;
    pending = Promise.resolve().then(() => {
      if (typeof callbacks.workAction !== 'function') throw Error('Work mode unavailable');
      return callbacks.workAction('toggle');
    }).then(mode => {
      if (editor.getExpandedText() === submitted) editor.setText('');
      announceWork(Boolean(mode?.enabled));
    }, error => { say(`Work mode failed: ${clean(error?.message ?? error)}`, 'error'); })
      .finally(() => { clearing = false; changed(); });
  };
  const setWorkFromChat = (submitted, wanted) => {
    if (wanted === Boolean(snapshot.work?.enabled)) {
      editor.setText('');
      say(`Work mode is already ${wanted ? 'on' : 'off'}.`, 'warning', { timeout: 3000 });
      changed();
    } else if (needsWorkFolder()) {
      editor.setText('');
      askForWorkFolder();
      changed();
    } else toggleWorkFromChat(submitted);
  };
  const sendMessage = text => {
    const report = referencedReport;
    const entry = { role: 'user', content: text, about: report?.title, at: new Date(now()).toISOString(), waiting: true };
    outbox.push(entry);
    editor.setText('');
    editor.addToHistory(text);
    referencedReport = null;
    view = 'conversation';
    focus = 'composer';
    scroll = 0;
    say('');
    changed();
    pending = Promise.resolve().then(() => callbacks.send(text, report)).then(() => {
      entry.accepted = true;
    }, error => {
      outbox = outbox.filter(item => item !== entry);
      if (!editor.getExpandedText()) {
        editor.setText(text);
        referencedReport = report;
      }
      say(`Send failed: ${clean(error?.message ?? error)}`, 'error');
    }).finally(() => {
      changed();
    });
  };
  // Whatever someone is already typing comes first, and /setup is still there for them.
  const sendWaitingSetup = () => {
    if (!setupWaiting || !connected()) return;

    setupWaiting = false;
    if (!editor.getExpandedText()) sendMessage(SETUP_REQUEST);
  };
  editor.onSubmit = submitted => {
    // Editor clears before onSubmit; a command keeps the draft until it succeeds.
    editor.setText(submitted);
    if (notingOn) {
      sendNote(submitted.trim());
      return;
    }
    if (askingWorkFolder) {
      // A path starts with a slash, so this comes before command handling.
      if (submitted.trim() && !clearing) startWorkIn(submitted.trim());
      return;
    }
    const named = submitted.match(/^\/work\s+(.+)$/)?.[1]?.trim();
    if (named && !clearing) {
      editor.addToHistory(submitted);
      if (['on', 'off'].includes(named)) setWorkFromChat(submitted, named === 'on');
      else startWorkIn(named);
      return;
    }
    if (submitted.startsWith('/')) {
      if (!localCommands.some(([name]) => name === submitted)) {
        say('Unknown command. Type /help to see them all.', 'warning');
        changed();
        return;
      }
      if (submitted === '/setup' && connected()) {
        sendMessage(SETUP_REQUEST);
        return;
      }
      editor.addToHistory(submitted);
      if (submitted === '/setup') {
        say('Offline. Run hobkin setup in a terminal to see what is missing.', 'warning');
        changed();
        return;
      }
      if (submitted === '/help') {
        editor.setText('');
        say('');
        localMessages.push({
          id: `help:${randomUUID()}`,
          role: 'assistant',
          content: helpGuide,
          at: new Date(now()).toISOString(),
        });
        scroll = 0;
        changed();
        return;
      }
      if (clearing) return;
      if (submitted === '/work' && needsWorkFolder()) {
        editor.setText('');
        askForWorkFolder();
        changed();
        return;
      }
      if (submitted === '/work') {
        toggleWorkFromChat(submitted);
        return;
      }
      const setting = settingCommands[submitted];
      if (setting) {
        clearing = true;
        pending = Promise.resolve().then(() => {
          if (typeof callbacks[setting.toggle] !== 'function') throw Error(`${setting.name} unavailable`);
          return callbacks[setting.toggle]();
        }).then(result => {
          if (editor.getExpandedText() === submitted) editor.setText('');
          say(result?.enabled ? setting.on : setting.off, 'success', { timeout: 3000 });
        }, error => { say(`${setting.name} failed: ${clean(error?.message ?? error)}`, 'error'); })
          .finally(() => { clearing = false; changed(); });
        return;
      }
      if (submitted === '/reset') {
        clearing = true;
        pending = Promise.resolve().then(() => {
          if (typeof callbacks.reset !== 'function') throw Error('Reset unavailable');
          return callbacks.reset();
        }).then(() => {
          if (editor.getExpandedText() === submitted) editor.setText('');
          say('Main context reset.', 'success');
        }, error => { say(`Reset failed: ${clean(error?.message ?? error)}`, 'error'); })
          .finally(() => { clearing = false; changed(); });
        return;
      }
      const messageIds = visibleMessageIds();
      clearing = true;
      pending = Promise.resolve().then(() => typeof callbacks.clear === 'function'
        ? callbacks.clear(messageIds)
        : { hiddenMessageIds: [...hiddenMessages, ...messageIds] })
        .then(result => {
          hiddenMessages = new Set([...hiddenMessages, ...(result?.hiddenMessageIds ?? messageIds)]);
          scroll = 0;
          if (editor.getExpandedText() === submitted) editor.setText('');
          say('Visible chat cleared; context and history kept.', 'success', { timeout: 3000 });
        }, error => {
          if (!editor.getExpandedText()) editor.setText(submitted);
          say(`Clear failed: ${clean(error?.message ?? error)}`, 'error');
        })
        .finally(() => {
          clearing = false;
          changed();
        });
      return;
    }
    if (!submitted.trim() || clearing) return;
    if (!connected()) {
      say('Offline — send unavailable until the main conversation connects', 'warning');
      changed();
      return;
    }
    sendMessage(submitted);
  };

  let quitArmedUntil = 0;
  // Ctrl+C clears first, so a stray press never closes hobkin on something half typed.
  const interrupt = () => {
    const filtering = isReportListFocus(focus) && (typingFilter || reportFilter.getValue());
    if (filtering || (focus === 'composer' && (editor.getExpandedText() || referencedReport))) {
      if (filtering) {
        clearFilter();
      } else {
        editor.setText('');
        referencedReport = null;
      }
      quitArmedUntil = 0;
      say('');
      return;
    }
    if (now() < quitArmedUntil) {
      callbacks.onQuit?.();
      return;
    }
    quitArmedUntil = now() + QUIT_WINDOW_MS;
    say('Press Ctrl+C again to quit.', 'warning', { timeout: QUIT_WINDOW_MS });
  };

  let completing = null;
  // The next Tab has to walk the commands that fit what was typed, not the one it just filled in.
  const completeCommand = () => {
    const draft = editor.getExpandedText();
    const typed = completing?.shown === draft ? completing.typed : draft;
    const names = localCommands.map(([name]) => name).filter(name => name.startsWith(typed));
    if (!typed.startsWith('/') || !names.length) return false;
    const shown = names[(names.indexOf(draft) + 1) % names.length];
    completing = { typed, shown };
    editor.setText(shown);
    return true;
  };

  const documents = new Map();
  const markdown = (value, width) => {
    const text = String(value ?? '').split('\n').map(clean).join('\n');
    if (!documents.has(text)) {
      if (documents.size >= 128) documents.delete(documents.keys().next().value);
      documents.set(text, new Markdown(text, 0, 0, palette.markdown));
    }
    return documents.get(text).render(width);
  };
  // Frames come far more often than messages change, and a streaming reply changes only its own rows.
  let chatRows = new Map();
  // New rows slide in below a view on the tail, and shift a reader's place so the text in front of them holds still.
  const followChat = (marks, frame) => {
    if (!motion) return;
    if (marks) scroll += motion.advance({ marks, following: !scroll, ...frame });
    else motion.reset();
    animate();
  };

  const jobTitle = run => run.title
    || snapshot.schedules?.find(schedule => schedule.id === run.scheduleId)?.title
    || 'Background job';
  // The filter takes the blank row under the subtabs, so the list stays put when it opens.
  const filterRow = inner => {
    reportFilter.focused = hasFocus && typingFilter && focus === 'reports';
    const query = reportFilter.getValue();
    if (!typingFilter && !query) return '';
    return `${accent('/')} ${typingFilter ? reportFilter.render(inner - 2)[0] : clean(query)}`;
  };
  const reportTabRows = (inner, y) => {
    const tabs = reportKinds.map(kind => {
      const matches = reportsOfKind(kind.name).length;
      return tabText({ ...kind, count: String(matches) }, kind.name === reportKind);
    });
    clickableTabs.push(...tabZones(tabs, y, 0));
    const tabRow = tabs.map(tab => tab.text).join(TAB_GAP);
    return [focus === 'reportTabs' ? selectedRow(tabRow, inner) : tabRow, filterRow(inner)];
  };
  const workTabRows = (inner, y) => {
    const tabs = workTabs.map(tab => tabText({ ...tab, count: tab.name === 'done' ? String(doneCount(snapshot.work ?? {})) : '' }, tab.name === workTab));
    clickableTabs.push(...tabZones(tabs.map(tab => ({ ...tab, name: `work-${tab.name}` })), y, 0));
    const tabRow = tabs.map(tab => tab.text).join(TAB_GAP);
    return [focus === 'workTabs' ? selectedRow(tabRow, inner) : tabRow, ''];
  };
  const renderHeader = (inner, clock, frame) => {
    const live = snapshot.connection === 'connected';
    const activeRuns = liveJobs();
    const indicator = !live ? muted('○') : snapshot.busy ? highlight(frame) : positive('●');
    const working = busySince ? `working ${elapsed(busySince, clock)}` : 'working';
    const connection = live && snapshot.busy ? working : clean(snapshot.connection ?? 'offline');
    const connectionStatus = `${indicator} ${dim(connection)}`;
    const runningCount = activeRuns.length + workRuns().length;
    const running = positive(`${runningCount} running`);
    const statuses = runningCount
      ? [`${connectionStatus}${dim(' · ')}${running}`, connectionStatus, indicator]
      : [connectionStatus];
    const scheduleCount = Object.values(snapshot.counts ?? {}).reduce((sum, count) => sum + count, 0);
    const proposals = (snapshot.work?.projects ?? []).filter(project => project.state === 'proposed').length;
    const needsYou = (snapshot.work?.allowanceRequest ? 1 : 0) + proposals;
    const tabs = [
      { name: 'conversation', label: 'Chat' },
      { name: 'reports', label: 'Reports', count: String(allReports().length) },
      { name: 'schedules', label: 'Routines', count: String(scheduleCount) },
      ...(decisions().length ? [{ name: 'decisions', label: 'Decisions', count: String(decisions().length) }] : []),
      ...(workVisible() ? [{
        name: 'work',
        label: 'Work Mode',
        count: needsYou ? String(needsYou) : '',
        prefix: `${workCircle(snapshot.work)} `,
      }] : []),
      ...activeRuns.map(run => ({ name: `job:${run.id}`, label: line(clean(jobTitle(run)), 24), prefix: `${positive(frame)} ` })),
    ].map(tab => tabText(tab, tab.name === view));
    images?.useTheme(palette.face.theme);
    const { lines: header, zones } = headerLines({ tabs, statuses, inner, wordmark: images?.wordmark() });
    clickableTabs = zones;
    const invalid = invalidSchedules().length;
    if (invalid) header.push(warning(`▲ ${invalid} invalid routine${invalid === 1 ? '' : 's'} · see Routines`));
    if (showsReportList()) return [...header, ...reportTabRows(inner, header.length)];
    return view === 'work' && !donePage ? [...header, ...workTabRows(inner, header.length)] : [...header, ''];
  };

  const doneKeys = row => {
    const opensToLand = row?.type === 'ready' || ['land', 'rebase'].includes(row?.gap);
    return opensToLand ? [['m', 'merge'], ['w', 'send agent'], ['n', 'no']] : [['x', 'done']];
  };
  const hintsFor = draft => {
    if (question) return [['↑↓', 'choose'], ['enter', 'answer'], ['esc', 'cancel'], ['pgup/pgdn', 'read']];
    if (askingWorkFolder) return [['enter', 'start'], ['esc', 'cancel']];
    if (notingOn) return [['enter', 'send the agent'], ['esc', 'cancel']];
    if (view === 'work' && donePage) return [...doneKeys(donePage.entry), ['d', 'diff'], ['r', 'review'], ['↑↓', 'scroll'], ['esc', 'back']];
    if (focus === 'workTabs') return [['←→', 'subtabs'], ['↓', 'rows'], ['esc', 'chat']];
    if (focus === 'decisions') return [[`1-${selectedDecision()?.choices.length ?? 2}`, 'answer'], ['↑↓', 'next one'], ['←→', 'views'], ['esc', 'chat']];
    if (isJob()) return [['k', 'cancel job'], ['pgup/pgdn', 'scroll'], ['←→', 'views'], ['esc', 'chat']];
    if (typingFilter && focus === 'reports') return [['enter', 'read'], ['↑↓', 'select'], ['esc', 'clear']];
    const leaveList = ['esc', reportFilter.getValue() ? 'clear filter' : 'chat'];
    if (focus === 'reportTabs') return [['←→', 'subtabs'], ['↓', 'reports'], ['/', 'filter'], leaveList];
    if (focus === 'reports') return [['↑↓', 'select'], ['enter', 'read'], ['/', 'filter'], ['←→', 'views'], leaveList];
    if (focus === 'detail') return [['r m', 'reply'], ['↑↓ pgup/pgdn', 'scroll'], ['esc', 'back'], ['←→', 'views']];
    if (focus === 'schedules') return [['↑↓ pgup/pgdn', 'scroll'], ['←→', 'views'], ['esc', 'chat']];
    if (focus === 'work') {
      const selected = selectedWorkRow();
      const rowKeys = {
        proposal: [['y', 'take'], ['1 2 3 4', 'level'], ['n', 'skip']],
        project: [['p', 'priority'], ['r', 'PRs'], ['1 2 3 4', 'level'], ['d d', 'drop']],
        allowance: [['y', 'raise'], ['n', 'keep paused']],
        run: [['enter', 'watch']],
        ready: [...doneKeys(selected), ['enter', 'read']],
        yours: [...doneKeys(selected), ['enter', 'read']],
        elsewhere: [...doneKeys(selected), ['enter', 'read']],
        queue: selected?.skipped ? [['s', 'put back']] : [['enter', 'run now'], ...(selected?.id ? [['p', 'grade'], ['x', 'done']] : []), ['s', 'skip']],
      };
      return [...rowKeys[selected?.type] ?? [], ['↑↓', 'select'], ['←→', 'views'], ['esc', 'chat']];
    }
    const commands = draft.startsWith('/') ? localCommands.filter(([name]) => name.startsWith(draft)) : [];
    if (commands.length) return commands;
    if (referencedReport) return [['enter', 'send'], ['esc', 'drop report'], ['ctrl+j', 'newline'], ['ctrl+c', 'clear']];
    if (draft) return [['enter', 'send'], ['ctrl+j', 'newline'], ['ctrl+c', 'clear']];
    return [['enter', 'send'], ['↑', 'history'], ['←→', 'views'], ['/', 'commands'], ['ctrl+q', 'quit']];
  };
  const nextCheck = (inner, clock) => {
    const schedules = snapshot.schedules ?? [];
    const upcoming = schedules.filter(schedule => schedule.enabled && schedule.nextRun?.at)
      .toSorted((a, b) => Date.parse(a.nextRun.at) - Date.parse(b.nextRun.at))[0];
    let detail;
    if (snapshot.connection !== 'connected') detail = muted('waiting for connection');
    else if (upcoming) {
      const title = line(clean(upcoming.title), Math.max(12, inner - 24));
      detail = `${assistantColor(title)}  ${accent(until(upcoming.nextRun.at, clock))}`;
    } else if (schedules.some(schedule => schedule.enabled)) detail = muted('no run scheduled');
    else if (schedules.length) detail = negative('none · all routines paused');
    else detail = muted('no routines');
    return `${muted('next check')}   ${detail}`;
  };
  const activityText = (hints, frame) => {
    if (notice) return toned(notice, noticeTone, frame);
    if (snapshot.error) return toned(snapshot.error, 'error', frame);
    if (question || focus !== 'composer') return hints;
    if (snapshot.context?.compacting && connected()) return highlight(`${frame} Compacting…`);
    if (!connected()) return toned('Offline — send unavailable', 'warning', frame);
    return hints;
  };
  const sessionBar = inner => {
    const { main = {} } = snapshot.config ?? {};
    const effort = snapshot.main?.effort ?? main.effort;
    const model = clean(snapshot.main?.model ?? main.model ?? '');
    const cost = Number.isFinite(snapshot.usage?.usd) ? accent(`$${snapshot.usage.usd.toFixed(2)} est.`) : '';
    const variants = [[true, true], [true, false], [false, false]].map(([withProvider, withGauge]) =>
      [modelLabel(effort, model, withProvider), contextLabel(snapshot.context, withGauge)].filter(Boolean).join('     '));
    const session = variants.find(value => visibleWidth(value) + visibleWidth(cost) + 2 <= inner)
      ?? modelLabel(effort, model, false);
    return row(session, cost, inner);
  };
  const memorySize = () => (Number.isFinite(snapshot.memoryBytes)
    ? `${muted('memory')} ${dim(kilobytes(snapshot.memoryBytes))}` : '');
  const greetingLine = clock => {
    const name = clean(snapshot.userName ?? '');
    if (!name || clock - startedAt >= TIP_SHOW_MS) return '';

    return accent(pickFrom(greetings, Math.floor(startedAt / 1000))(name));
  };
  const tipLine = clock => {
    const greeting = greetingLine(clock);
    if (greeting) return greeting;

    const tip = tipAt([...tips, ...(snapshot.jev ? [] : [jevTip]), ...(snapshot.learning ? [] : [learningTip]), ...ignoredTips(snapshot.reportAttention ?? [])], clock);
    return tip ? `${muted('tip')}  ${dim(tip)}` : '';
  };
  const drawnFace = clock => {
    const mood = moodNow(clock);
    return images ? images.lines(mood, clock) : faceLines(mood, clock, { ...palette.face, octants: supportsOctants() });
  };
  const besideFace = (face, rows, width) => {
    const blank = ' '.repeat(faceColumns());
    return rows.map((value, index) => `${face[index] ?? blank}${' '.repeat(FACE_GAP)}${line(value, width)}`);
  };
  const composerLines = inner => {
    const [above, ...lines] = editor.render(inner - 4);
    const below = lines.pop();
    const paint = editor.focused && connected() ? assistantColor : muted;
    const prompted = referencedReport ? 'Ask about this report…' : 'Message hobkin…';
    const placeholder = askingWorkFolder ? 'A path, like ~/Projects'
      : notingOn ? 'What should it change? Empty closes what stops it merging'
      : connected() ? prompted : 'Waiting for the main conversation…';
    const empty = !editor.getExpandedText();
    const content = lines.map((value, index) => {
      const prompt = index ? '    ' : `  ${connected() ? highlight('❯') : muted('❯')} `;
      return prompt + (empty && !index ? value.trimEnd() + muted(placeholder) : value);
    });
    const subject = askingWorkFolder ? 'Which folder should work mode start from?' : notingOn?.title ?? referencedReport?.title;
    const reference = subject ? `${accent('↳')} ${dim(line(clean(subject), inner - 16))}` : '';
    const top = [reference, above && muted(above)].filter(Boolean).join(muted(' · '));
    return ruled({ paint, top, bottom: below && muted(below), lines: content, inner });
  };
  const onOtherRow = () => question.selection.getSelectedItem() === OTHER_ROW;
  // The row stays reserved, so moving onto Other never moves the list.
  const typingRow = width => {
    if (!question.other) return [];
    if (!onOtherRow()) return [''];

    question.other.focused = hasFocus;
    return question.other.render(width);
  };
  const questionBox = (inner, height, headerLength) => {
    // Every choice shows when there is room, on any size the terminal takes. The constructor is the only public way to set this, and it is once.
    question.selection.maxVisible = Math.max(FEWEST_CHOICES_SHOWN, height - headerLength - ROWS_AROUND_CHOICES);
    const choices = question.selection.render(inner - 4);
    const typing = typingRow(inner - 4);
    const label = question.selection.getSelectedItem()?.label ?? '';
    // The list truncates long choices, so the selected one is also readable in full above it.
    const fullChoice = visibleWidth(clean(label)) > inner - 6 ? ['', ...wrapped(label, inner - 4).map(accent)] : [];
    const text = [...wrapped(question.question, inner - 4).map(bold), ...fullChoice];
    const capacity = Math.max(1, Math.min(Math.floor((height - headerLength) / 2),
      height - headerLength - choices.length - typing.length - 11));
    question.scroll = Math.min(question.scroll, Math.max(0, text.length - capacity));
    question.overflows = text.length > capacity;
    const visibleText = text.slice(question.scroll, question.scroll + capacity);
    return boxed({ paint: highlight, top: highlight(bold('hobkin asks')), lines: [...visibleText, '', ...choices, ...typing], inner });
  };
  const renderFooter = (inner, height, headerLength, clock, frame) => {
    editor.focused = hasFocus && focus === 'composer';
    const hasComposer = !question && (view === 'conversation' || askingWorkFolder || Boolean(notingOn));
    const faceFits = hasComposer && inner >= MIN_WIDTH_FOR_FACE && height >= MIN_ROWS_FOR_TIP_LINE;
    if (faceFits !== faceShown) {
      faceShown = faceFits;
      animate();
    }
    const faceWidth = faceColumns() + FACE_GAP;
    const room = faceShown ? inner - faceWidth : inner;
    const hints = hintsFor(editor.getExpandedText());
    // Drop whole hints from the end rather than cutting one mid-word.
    let shown = hints.length;
    while (shown > 1 && visibleWidth(keys(hints.slice(0, shown))) > room) shown--;
    const activity = activityText(keys(hints.slice(0, shown)), frame);
    const rule = centered(faint('─'.repeat(Math.round(inner * FOOTER_RULE_SHARE))), inner);
    const workNote = snapshot.work?.enabled ? accent(workRuns().length ? `work ${workRuns().length} running` : 'work on') : '';
    const memory = [workNote, memorySize()].filter(Boolean).join(muted(' · '));
    const nextCheckRow = row(nextCheck(inner - visibleWidth(memory) - 2, clock), memory, inner);
    const statusLines = [activity, rule, nextCheckRow, sessionBar(inner)];
    // The row stays reserved so a tip coming or going never moves anything.
    const tipRows = height >= MIN_ROWS_FOR_TIP_LINE ? [tipLine(clock)] : [];
    if (question) return [...questionBox(inner, height, headerLength), ...tipRows, ...statusLines];
    if (faceShown) {
      const [activityRow, ...rest] = statusLines;
      const face = drawnFace(clock);
      // A mood's speed is known once its frames have loaded.
      animate();
      const beside = [...composerLines(room), ...tipRows, activityRow];
      return [...besideFace(face, beside, room), ...rest];
    }
    if (hasComposer) return [...composerLines(inner), ...tipRows, ...statusLines];
    return [tipRows[0] ?? '', ...statusLines];
  };
  const renderContent = (inner, available, clock, frame) => {
    const live = snapshot.connection === 'connected';
    const activeRuns = liveJobs();
    if (view === 'schedules') {
      return {
        content: scheduleLines({
          schedules: snapshot.schedules ?? [],
          counts: snapshot.counts ?? {},
          diagnostics: invalidSchedules(),
          attention: snapshot.reportAttention ?? [],
          activeRuns,
          live,
          inner,
          clock,
          frame,
        }),
      };
    }
    if (view === 'decisions') return decisionLines({ decisions: decisions(), selected: selectedDecision(), inner, clock });
    if (view === 'work' && donePage) return doneReading({ ...donePage, inner });
    if (view === 'work' && workTab === 'done') {
      const sections = currentWorkSections(inner, clock, frame);
      return doneLines({ sections, selected: focus === 'workTabs' ? null : selectedWorkRow(sections), inner });
    }
    if (view === 'work') {
      const sections = currentWorkSections(inner, clock, frame);
      const runs = workRuns();
      const looking = runs.find(run => run.work?.lane === 'discover');
      const step = latestStep(snapshot.jobActivity?.[looking?.id]);
      const selected = focus === 'workTabs' ? null : selectedWorkRow(sections);
      return workLines({ work: snapshot.work ?? {}, runs, sections, selected, step, inner, clock, frame });
    }
    if (isJob()) {
      return {
        content: jobActivityLines({
          run: [...activeRuns, ...workRuns()].find(run => `job:${run.id}` === view),
          blocks: snapshot.jobActivity?.[view.slice(4)] ?? [],
          inner,
          clock,
          frame,
          markdown,
        }),
      };
    }
    if (view === 'conversation') {
      const conversation = [...(snapshot.messages ?? []).filter(isVisible), ...outbox];
      const messages = localMessages.filter(isVisible).reduce(placeByTime, conversation);
      const known = chatRows;
      chatRows = new Map();
      const { content, days, marks } = chatLines({
        messages,
        inner,
        clock,
        rowsOf: (key, entry) => {
          const lines = known.get(key) ?? messageLines(entry, inner, markdown);
          chatRows.set(key, lines);
          return lines;
        },
      });
      return content.length ? { content, days, marks } : { content: welcomeLines(inner, available, !snapshot.schedules?.length), marks };
    }
    if (showsReportList()) {
      return reportListLines({
        reports: reports(),
        total: reportsOfKind(reportKind).length,
        selectedId: focus === 'reportTabs' ? null : selectedId,
        filtered: Boolean(filterText()),
        inner,
        clock,
      });
    }
    return {
      content: reportDetailLines({ report: completedReport ?? reports()[selectedIndex()], inner, clock, markdown }),
    };
  };

  const runWorkAction = (...request) => {
    pending = Promise.resolve().then(() => callbacks.workAction(...request))
      .then(result => { if (result?.ok) say(clean(result.message)); })
      .catch(error => { say(`Work mode failed: ${clean(error?.message ?? error)}`, 'error'); })
      .finally(changed);
  };
  const workRows = () => currentWorkSections(columns - 4, now(), '').flatMap(([, entries]) => entries).filter(entry => entry.key);
  const moveWorkSelection = delta => {
    const rows = workRows();
    const index = Math.max(0, rows.findIndex(entry => entry.key === selectedWorkRow()?.key));
    if (index + delta < 0) {
      focus = 'workTabs';
      return;
    }
    workKey = rows[Math.min(rows.length - 1, index + delta)]?.key ?? null;
  };
  const rowFor = ({ slug, id }) => (snapshot.work?.ready ?? []).find(entry => entry.slug === slug && entry.item === id);
  const readRow = selected => {
    const entry = rowFor(selected);
    if (!entry) return;
    donePage = { entry, description: null };
    focus = 'doneReading';
    scroll = 0;
    const opened = donePage;
    pending = Promise.resolve().then(() => callbacks.workAction('pr', selected.slug, selected.id))
      .then(found => { opened.description = found?.description ?? null; })
      .catch(() => {})
      .finally(changed);
  };
  const leaveReading = () => {
    donePage = null;
    focus = 'work';
    scroll = 0;
  };
  // Whatever was answered leaves the list, so the walk carries straight on to the next one.
  const walkOn = selected => {
    const rows = workRows();
    const index = rows.findIndex(entry => entry.key === selected.key);
    const next = rows[index + 1] ?? rows[index - 1];
    const wasReading = Boolean(donePage);
    workKey = next?.key ?? null;
    leaveReading();
    if (wasReading && next) readRow(next);
  };
  const selectedDone = () => {
    if (!donePage) return selectedWorkRow();
    const { entry } = donePage;
    return workRows().find(({ slug, id }) => slug === entry.slug && id === entry.item) ?? { key: null, slug: entry.slug, id: entry.item, title: entry.title };
  };
  const mergeRow = selected => {
    if (selected.risky && armedMerge !== selected.key) {
      armedMerge = selected.key;
      say(`Rated risky. Press m again to merge ${clean(selected.title)}.`, 'warning', { timeout: 3000 });
      return;
    }
    armedMerge = null;
    walkOn(selected);
    runWorkAction('merge', selected.slug, selected.id);
  };
  const startNote = selected => {
    notingOn = selected;
    focus = 'composer';
    say('');
  };
  const sendNote = text => {
    const { slug, id } = notingOn;
    const selected = notingOn;
    notingOn = null;
    editor.setText('');
    focus = 'work';
    walkOn(selected);
    runWorkAction('ask', slug, id, text);
  };
  const handleDoneRowKey = (selected, data) => {
    if (data === 'm') mergeRow(selected);
    else if (data === 'w') startNote(selected);
    else if (data === 'n') {
      walkOn(selected);
      runWorkAction('decline', selected.slug, selected.id);
    } else return false;
    return true;
  };
  const closeRow = selected => {
    walkOn(selected);
    runWorkAction('done', selected.slug, selected.id);
  };
  const handleReadingKey = data => {
    const selected = selectedDone();
    const canMerge = ['land', 'rebase'].includes(donePage.entry.gap ?? 'land');
    if (key(data, 'escape')) leaveReading();
    else if (data === 'd') runWorkAction('diff', selected.slug, selected.id);
    else if (data === 'r') runWorkAction('review', selected.slug, selected.id);
    else if (data === 'x' && !canMerge) closeRow(selected);
    else if (!canMerge || !handleDoneRowKey(selected, data)) return false;
    return true;
  };
  const dropProjectTwice = selected => {
    if (armedDrop === selected.slug) {
      armedDrop = null;
      say('');
      runWorkAction('drop', selected.slug);
      return;
    }
    armedDrop = selected.slug;
    say(`Press d again to drop ${clean(selected.name ?? selected.slug)}.`, 'warning', { timeout: 3000 });
  };
  // `max` is the dearest thing a key can do, so like a drop it takes a second press.
  const maxTwice = (selected, act) => {
    if (armedMax === selected.slug) {
      armedMax = null;
      say('');
      act();
      return;
    }
    armedMax = selected.slug;
    say(`Press 4 again for max: Claude Opus at max effort on ${clean(selected.name ?? selected.slug)}.`, 'warning', { timeout: 3000 });
  };
  // A row that was answered leaves the list, so the next proposal is ready for the next key.
  const answerProposal = (selected, ...request) => {
    const proposals = workRows().filter(entry => entry.type === 'proposal');
    const index = proposals.findIndex(entry => entry.key === selected.key);
    workKey = (proposals[index + 1] ?? proposals[index - 1])?.key ?? null;
    runWorkAction(...request);
  };
  const handleWorkKey = data => {
    if (key(data, 'up') || key(data, 'down')) {
      moveWorkSelection(key(data, 'down') ? 1 : -1);
      return true;
    }
    const selected = selectedWorkRow();
    const level = { 1: 'critical', 2: 'important', 3: 'casual' }[data];
    const enter = key(data, 'enter');
    if (selected?.type === 'proposal' && data === 'y') answerProposal(selected, 'choose', selected.slug);
    else if (selected?.type === 'proposal' && data === '4') maxTwice(selected, () => answerProposal(selected, 'choose', selected.slug, 'max'));
    else if (selected?.type === 'proposal' && level) answerProposal(selected, 'choose', selected.slug, level);
    else if (selected?.type === 'proposal' && data === 'n') answerProposal(selected, 'skip', selected.slug);
    else if (selected?.type === 'project' && data === '4') maxTwice(selected, () => runWorkAction('level', selected.slug, 'max'));
    else if (selected?.type === 'project' && level) runWorkAction('level', selected.slug, level);
    else if (selected?.type === 'project' && data === 'd') dropProjectTwice(selected);
    else if (selected?.type === 'project' && data === 'p') runWorkAction('priority', selected.slug, nextIn(grades, selected.priority));
    else if (selected?.type === 'project' && data === 'r') runWorkAction('prs', selected.slug, nextIn(prModes, selected.prMode ?? 'off'));
    else if (selected?.type === 'allowance' && data === 'y') runWorkAction('allow');
    else if (selected?.type === 'allowance' && data === 'n') runWorkAction('keep');
    else if (selected?.type === 'queue' && enter && !selected.skipped) runWorkAction('run', selected.queueKey);
    else if (selected?.type === 'queue' && data === 's') runWorkAction(selected.skipped ? 'back' : 'later', selected.queueKey);
    else if (selected?.type === 'queue' && selected.id && data === 'p') runWorkAction('grade', selected.slug, selected.id, nextIn(grades, selected.grade));
    else if (doneRowTypes.includes(selected?.type) && enter) readRow(selected);
    else if (selected?.type === 'ready' && handleDoneRowKey(selected, data)) return true;
    else if (['yours', 'elsewhere'].includes(selected?.type) && data === 'x') closeRow(selected);
    else if (selected?.type === 'queue' && selected.id && data === 'x') runWorkAction('done', selected.slug, selected.id);
    else if (selected?.type === 'run' && key(data, 'enter')) {
      view = `job:${selected.id}`;
      focus = 'job';
      scroll = 0;
    } else return false;
    return true;
  };

  const openView = name => {
    askingWorkFolder = false;
    notingOn = null;
    donePage = null;
    typingFilter = false;
    view = name;
    if (view === 'conversation') {
      focus = 'composer';
    } else if (isJob()) {
      focus = 'job';
    } else {
      focus = view;
    }
    if (view === 'reports') completedReport = null;
    keepSelectionListed();
    scroll = 0;
  };
  const handleDecisionKey = data => {
    const list = decisions();
    const selected = selectedDecision();
    const choice = selected?.choices[Number(data) - 1];
    if (key(data, 'up') || key(data, 'down')) {
      const index = list.indexOf(selected) + (key(data, 'down') ? 1 : -1);
      decisionId = list[Math.max(0, Math.min(list.length - 1, index))]?.id ?? null;
    } else if (choice) {
      decisionId = (list[list.indexOf(selected) + 1] ?? list[list.indexOf(selected) - 1])?.id ?? null;
      runWorkAction('decide', selected.id, choice.value);
    } else {
      return false;
    }
    return true;
  };
  const showWorkTab = name => {
    workTab = name;
    workKey = null;
    donePage = null;
    scroll = 0;
  };
  const handleWorkTabsKey = data => {
    if (key(data, 'left') || key(data, 'right')) {
      showWorkTab(workTab === 'now' ? 'done' : 'now');
    } else if (key(data, 'down') || key(data, 'enter')) {
      focus = 'work';
    } else {
      return key(data, 'up');
    }
    return true;
  };
  const handleReportTabsKey = data => {
    if (key(data, 'left') || key(data, 'right')) {
      stepReportKind(key(data, 'right') ? 1 : -1);
    } else if (key(data, 'down') || key(data, 'enter')) {
      focus = 'reports';
    } else if (key(data, '/')) {
      startFilter();
    } else {
      return key(data, 'up');
    }
    return true;
  };
  const handleFilterKey = data => {
    if (key(data, 'escape')) {
      clearFilter();
    } else if (key(data, 'up') || key(data, 'down')) {
      moveReportSelection(key(data, 'down') ? 1 : -1);
    } else if (key(data, 'enter')) {
      typingFilter = false;
      if (reports().length) {
        focus = 'detail';
        scroll = 0;
      }
    } else if (key(data, 'backspace') && !reportFilter.getValue()) {
      typingFilter = false;
    } else {
      reportFilter.handleInput(data);
      keepSelectionListed();
      scroll = 0;
    }
  };
  // Every row sits inside the frame's two columns of margin.
  const tabAt = ({ x, y }) => clickableTabs.find(zone => zone.y === y && x - 2 >= zone.from && x - 2 < zone.to)?.name;
  const openTab = name => {
    if (reportKinds.some(kind => kind.name === name)) {
      showReportKind(name);
    } else if (name.startsWith('work-')) {
      showWorkTab(name.slice('work-'.length));
      focus = 'work';
    } else {
      openView(name);
    }
  };

  const controller = {
    state: () => ({ selectedId, focus, view, scroll, draft: editor.getExpandedText(), notice, mood: moodNow(now()) }),
    get focused() { return hasFocus; },
    set focused(value) { hasFocus = value; },
    pending: () => pending,
    setHandlers(next) {
      callbacks = next;
      changed();
    },
    update(next) {
      const wasOn = workVisible();
      // Connecting replaces the saved chat with the live one, which is not anything arriving.
      if (next.connection !== snapshot.connection) motion?.reset();
      snapshot = next;
      // Here rather than in /work, because the main agent can turn it on or off too.
      if (workVisible() !== wasOn) {
        say(wasOn ? 'Work mode off. The Work Mode tab is hidden.' : 'Work mode on. The Work Mode tab has appeared.', 'success', { timeout: 5000 });
      }
      settleOutbox();
      for (const id of next.presentation?.hiddenMessageIds ?? []) hiddenMessages.add(id);
      const target = question?.previous ?? { view, focus, scroll };
      if ((target.view === 'work' && !workVisible()) || (target.view === 'decisions' && !decisions().length)) {
        target.view = 'conversation';
        target.focus = 'composer';
      }
      if (target.view.startsWith('job:') && !jobViews().includes(target.view)) {
        completedReport = next.completedJobReports?.[target.view.slice(4)] ?? null;
        if (completedReport) {
          selectedId = completedReport.id;
          if (reportKind !== 'all') reportKind = reportKindOf(completedReport);
          reportFilter.setValue('');
        }
        target.view = completedReport ? 'reports' : 'conversation';
        target.focus = completedReport ? 'detail' : 'composer';
        target.scroll = 0;
      }
      if (!question) {
        ({ view, focus, scroll } = target);
      } else {
        view = target.view;
      }
      keepSelectionListed();
      animate();
      changed();
      sendWaitingSetup();
    },
    startSetup() {
      setupWaiting = true;
      sendWaitingSetup();
    },
    invalidate() {
      editor.invalidate();
      documents.clear();
      chatRows.clear();
    },
    showDone() {
      openView('work');
      showWorkTab('done');
      changed();
    },
    askQuestion(request, signal) {
      // Someone is waiting on this one, and what it replaces can wait in Decisions.
      if (question?.whenQuiet && !request.whenQuiet) question.finish(null);
      if (stopped || question) return Promise.resolve(undefined);
      if (signal?.aborted) return Promise.resolve(null);
      // A question nobody is waiting on stays out of the way of what the user is typing.
      if (request.whenQuiet && editor.getExpandedText()) return Promise.resolve(undefined);
      return new Promise(resolve => {
        const previous = { focus, view, scroll };
        const selection = new SelectList(request.other ? [...request.choices, OTHER_ROW] : request.choices, FEWEST_CHOICES_SHOWN, selectTheme);
        const other = request.other ? new Input({ placeholder: 'Type here, then Enter', placeholderStyle: dim }) : null;
        const current = { ...request, other, selection, finish, previous, scroll: 0 };
        function finish(value) {
          if (question !== current) return;
          clearTimeout(expiry);
          signal?.removeEventListener('abort', cancel);
          question = null;
          ({ focus, view, scroll } = previous);
          resolve(value);
          changed();
        }
        const cancel = () => finish(null);
        const expiry = request.waitMs ? setTimeout(cancel, request.waitMs) : null;
        selection.onSelectionChange = () => { current.scroll = 0; };
        selection.onSelect = item => {
          if (item !== OTHER_ROW) {
            finish(item.value);
            return;
          }

          // An empty Other is no answer, so Enter waits for one.
          const typed = other.getValue().trim();
          if (typed) finish({ typed });
        };
        selection.onCancel = cancel;
        signal?.addEventListener('abort', cancel, { once: true });
        question = current;
        focus = 'question';
        changed();
      });
    },
    stop() {
      trackReading(null);
      stopped = true;
      clearTimeout(noticeTimer);
      clearInterval(idleRedraw);
      animate();
      images?.clear();
      question?.finish(null);
    },
    handleMouse(event) {
      if (question) return;
      if (event.type === 'press' || event.type === 'click') {
        const tab = event.button === 'left' ? tabAt(event) : null;
        if (!tab) return;
        if (event.type === 'click') {
          openTab(tab);
          changed();
        }
        // Taking the press too is what makes the click arrive, and stops it starting a text selection.
        return { handled: true };
      }
      if (event.type !== 'wheel') return;
      if (event.y >= contentBounds.top && event.y < contentBounds.bottom && !isReportListFocus(focus)) {
        const delta = (event.wheelDelta ?? 0) * (followsTail() ? -1 : 1);
        scroll = Math.max(0, scroll + delta);
        changed();
      }
      return { handled: true };
    },
    input(data) {
      if (key(data, 'ctrl+q')) {
        callbacks.onQuit?.();
        return;
      }
      if (key(data, 'ctrl+c')) {
        interrupt();
        changed();
        return;
      }
      // Nobody is waiting on this kind of question, so typing past it means "not now" and the key carries on to wherever the user was.
      if (question?.whenQuiet && PRINTABLE_KEY.test(data)) question.finish(null);
      if (question) {
        const tooSmall = (options.tui?.terminal.columns ?? columns) < 60 || (options.tui?.terminal.rows ?? rows) < 18;
        const paging = !tooSmall && (key(data, 'pageUp') || key(data, 'pageDown'));
        if (key(data, 'escape')) question.finish(null);
        else if (paging && followsTail() && !question.overflows) {
          // What a question is about is in the conversation above it, and on a small terminal it does not all fit.
          scroll = Math.max(0, scroll + (key(data, 'pageUp') ? 8 : -8));
        } else if (paging) {
          question.scroll = Math.max(0, question.scroll + (key(data, 'pageDown') ? 2 : -2));
        } else if (!tooSmall) {
          // Only the Other row takes typing, so what the user was writing as a question opened never becomes an answer.
          const listKey = key(data, 'up') || key(data, 'down') || key(data, 'enter');
          const target = onOtherRow() && !listKey ? question.other : question.selection;
          target.handleInput(data);
        }
        changed();
        return;
      }
      if (data === 'k' && isJob()) {
        const runId = view.slice(4);
        say('Requesting cancellation…', 'progress');
        pending = Promise.resolve().then(() => {
          if (typeof callbacks.kill !== 'function') throw Error('Kill unavailable');
          return callbacks.kill(runId);
        }).then(accepted => {
          if (accepted) say('Cancellation accepted.', 'success');
          else say('No owned running job.', 'warning');
        }, error => { say(`Kill failed: ${clean(error?.message ?? error)}`, 'error'); })
          .finally(changed);
      } else if (focus === 'work' && handleWorkKey(data)) {
        // The Work tab handled it.
      } else if (focus === 'decisions' && handleDecisionKey(data)) {
        // The Decisions tab handled it.
      } else if (focus === 'workTabs' && handleWorkTabsKey(data)) {
        // The subtab row handled it.
      } else if (focus === 'doneReading' && handleReadingKey(data)) {
        // The page being read handled it.
      } else if (focus === 'reportTabs' && handleReportTabsKey(data)) {
        // The subtab row handled it.
      } else if ((key(data, 'm') || key(data, 'r')) && focus === 'detail') {
        referencedReport = reportOnScreen();
        view = 'conversation';
        focus = 'composer';
        scroll = 0;
      } else if (typingFilter && (reportFilter.getValue() || !(key(data, 'left') || key(data, 'right')))) {
        handleFilterKey(data);
      } else if ((key(data, 'left') || key(data, 'right'))
        && (focus !== 'composer' || !editor.getExpandedText())) {
        const tabs = views();
        const direction = key(data, 'left') ? -1 : 1;
        openView(tabs[(tabs.indexOf(view) + direction + tabs.length) % tabs.length]);
      } else if (followsTail() && (key(data, 'pageUp') || key(data, 'pageDown'))) {
        scroll = Math.max(0, scroll + (key(data, 'pageUp') ? 8 : -8));
      } else if (focus === 'composer') {
        if (key(data, 'escape')) {
          say('');
          referencedReport = null;
          askingWorkFolder = false;
          if (notingOn) {
            notingOn = null;
            editor.setText('');
            focus = 'work';
          }
        } else if (key(data, 'tab') && !askingWorkFolder && completeCommand()) {
          // Tab finished the command.
        } else {
          editor.disableSubmit = clearing;
          editor.handleInput(data);
        }
      } else if (key(data, 'escape')) {
        if (focus === 'detail') {
          focus = 'reports';
          completedReport = null;
          keepSelectionListed();
        } else if (view === 'reports' && reportFilter.getValue()) {
          clearFilter();
        } else {
          const watchingWork = workVisible() && workRuns().some(run => `job:${run.id}` === view);
          view = watchingWork ? 'work' : 'conversation';
          focus = watchingWork ? 'work' : 'composer';
        }
        scroll = 0;
      } else if (view === 'reports' && focus === 'reports' && key(data, 'up') && !selectedIndex()) {
        focus = 'reportTabs';
      } else if (view === 'reports' && focus === 'reports' && (key(data, 'up') || key(data, 'down'))) {
        moveReportSelection(key(data, 'down') ? 1 : -1);
      } else if (view === 'reports' && focus === 'reports' && key(data, 'enter')) {
        focus = 'detail';
        scroll = 0;
      } else if (view === 'reports' && focus === 'reports' && key(data, '/')) {
        startFilter();
      } else if (key(data, 'pageDown') || key(data, 'down')) {
        scroll = Math.max(0, scroll + (key(data, 'pageDown') ? 8 : 1) * (isJob() ? -1 : 1));
      } else if (key(data, 'pageUp') || key(data, 'up')) {
        scroll = Math.max(0, scroll + (key(data, 'pageUp') ? 8 : 1) * (isJob() ? 1 : -1));
      }
      changed();
    },
    render(width, height) {
      width = Math.max(1, width);
      height = Math.max(1, height);
      rows = height;
      columns = width;
      contentBounds = { top: 0, bottom: 0 };
      clickableTabs = [];
      const tooSmall = text => {
        motion?.reset();
        return [line(text, width)];
      };
      if (question && (width < 60 || height < 18)) return tooSmall('Enlarge to 60x18 to answer; Esc cancels.');
      if (width < 35 || height < 14) return tooSmall('hobkin · enlarge terminal (35x14)');
      const inner = width - 4;
      const clock = now();
      const frame = spinner(clock);
      const header = renderHeader(inner, clock, frame);
      const footer = renderFooter(inner, height, header.length, clock, frame);
      const available = Math.max(1, height - header.length - footer.length);
      contentBounds = { top: header.length, bottom: height - footer.length };

      const { content, ranges = [], days = [], marks, selectedRange } = renderContent(inner, available, clock, frame);
      const { trueColor: fading } = getCapabilities();
      followChat(marks, { available, layout: `${width}x${height}`, clock, fading, busy: snapshot.busy });
      const maximum = Math.max(0, content.length - available);
      if (!question || followsTail()) scroll = Math.min(scroll, maximum);
      const displayScroll = Math.min(scroll, maximum);
      const listMode = showsReportList() || view === 'work';
      if (listMode) {
        const [start, end] = selectedRange ?? ranges[selectedIndex()] ?? [0, 0];
        if (start < listTop) listTop = start;
        if (end > listTop + available) listTop = end - available;
        listTop = Math.max(0, Math.min(listTop, maximum));
      }
      let offset = displayScroll;
      if (listMode) offset = listTop;
      else if (followsTail()) offset = maximum - displayScroll;

      const framed = value => `  ${line(value, inner)}`;
      const placed = motion?.place(content, offset) ?? { rows: content, offset, gap: 0 };
      const body = viewport({ content: placed.rows, offset: placed.offset, available, inner });
      // Chat usually overflows, and Reports always opens on its heading, so the day stays pinned while scrolled.
      const pinned = days.findLast(day => day.line <= placed.offset + 1 && !(placed.gap && day.line >= placed.anchor));
      const pinnedRows = pinned && available >= MIN_ROWS_FOR_PINNED_DAY ? 2 : 0;
      if (pinnedRows) body.splice(0, pinnedRows, framed(pinned.heading), framed(''));
      const shown = motion?.faint && fading ? motion.fade(body, { ...placed, first: pinnedRows }, fadeColors[palette.face.theme]) : body;
      return [...header.map(framed), ...shown, ...footer.map(framed)];
    },
  };
  animate();
  return controller;
}

export function startDashboard(snapshot, handlers = {}, options = {}) {
  const images = options.images ?? (!options.terminal && supportsFaceImages() ? new FaceImages({ write: data => tui.terminal.write(data) }) : null);
  // Left to itself, the screen code deletes every image on the terminal at each full redraw, and it does not know about these.
  if (images) setCapabilityOverrides({ images: null });
  const tui = new TuiAltScreen(options.terminal ?? new ProcessTerminal(), false, undefined, { mouse: true, wheelScrollLines: 3 });
  const controller = createDashboard(snapshot, handlers, {
    tui, images, now: options.now, motion: options.motion ?? true, onChange: () => tui.requestRender(),
  });
  const component = {
    render: width => controller.render(width, tui.terminal.rows),
    handleInput: data => controller.input(data),
    handleMouse: event => controller.handleMouse(event),
    invalidate: () => controller.invalidate(),
    get focused() { return controller.focused; },
    set focused(value) { controller.focused = value; },
  };
  tui.addChild(component);
  tui.setFocus(component);

  // Paint with the user's Pi theme from the first frame and follow later theme switches or edits.
  const theme = options.theme ? followPiTheme(options.theme.cwd, next => {
    palette = next;
    controller.invalidate();
    tui.requestRender();
  }) : null;
  palette = theme?.palette ?? builtInPalette;

  // The dashboard owns paging and composer boundaries, not the outer viewport.
  const keybindings = getKeybindings();
  const previousBindings = keybindings.getUserBindings();
  let typingBindings = {};
  try {
    const config = JSON.parse(readFileSync(join(options.agentDir ?? getAgentDir(), 'keybindings.json'), 'utf8'));
    typingBindings = Object.fromEntries(Object.entries(config).filter(([name, keys]) =>
      /^(tui\.editor\.|tui\.input\.|tui\.select\.)/.test(name)
      && (typeof keys === 'string' || (Array.isArray(keys) && keys.every(key => typeof key === 'string')))));
  } catch { /* Missing or invalid optional keybindings use Pi defaults. */ }
  keybindings.setUserBindings({
    ...previousBindings,
    ...typingBindings,
    'tui.altScreen.pageUp': [],
    'tui.altScreen.pageDown': [],
    'tui.altScreen.top': [],
    'tui.altScreen.bottom': [],
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    theme?.stop();
    palette = builtInPalette;
    controller.stop();
    try {
      tui.stop({ preserveScreen: true });
    } finally {
      keybindings.setUserBindings(previousBindings);
    }
  };
  try {
    tui.start();
  } catch (error) {
    stop();
    throw error;
  }
  return { ...controller, stop };
}
