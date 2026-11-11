import { stripVTControlCharacters } from 'node:util';

const clean = value => typeof value === 'string'
  ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '') : '';
const inputText = value => clean(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
// Only public content blocks, never result details or internal event records.
const outputText = value => {
  const content = Array.isArray(value) ? value : value?.content ?? value;
  if (typeof content === 'string') return clean(content);
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && part.display !== false)
    .map(part => clean(part.text)).join('\n');
};
const OUT = new Set(['queued', 'running']);
// A field teams gave as words, terminal-safe, or nothing.
const stated = value => typeof value === 'string' && value ? clean(value) : undefined;

/**
 * Agents a Pi session spawned through pi-extended-teams, by name, read from teams' spawn and status results and its
 * report and wake messages only, never their content. They run inside that session, so it is their parent; an
 * agent's own read agents never reach its stream and are not listed. A job's run and the main chat each keep one.
 */
export class SpawnedAgents {
  agents = new Map();

  constructor({ now = Date.now } = {}) {
    this.now = now;
  }

  accept(event) {
    try {
      this.follow(event);
    } catch {
      /* Display data must not fail execution. */
    }
  }

  follow(event) {
    if (event?.type === 'tool_execution_end' && !event.isError && event.result?.details) {
      const { details } = event.result;
      if (event.toolName === 'spawn_agent') this.spawned(details);
      if (event.toolName === 'spawn_swarm_agents') {
        const group = stated(details.completionGroup?.groupId);
        for (const agent of details.spawned ?? []) this.spawned(agent, group);
        for (const agent of details.failed ?? []) this.spawned(agent, group, 'failed');
      }
      if (event.toolName === 'get_agent_status') for (const status of details.statuses ?? []) this.refine(status);
    } else if (event?.type === 'message_end') {
      const { customType, details } = event.message ?? {};
      if (customType === 'pi-extended-teams-report') this.finish(this.agents.get(stated(details?.name)), details?.ok === false ? 'failed' : 'reported');
      // A grouped swarm reports once for all its agents, which says nothing of each one's success.
      const group = customType === 'pi-extended-teams-wake' && stated(details?.completionGroup?.groupId);
      for (const agent of group ? this.agents.values() : []) if (agent.group === group) this.finish(agent, 'reported');
    }
  }

  spawned(details, group, state = details?.queued === true ? 'queued' : 'running') {
    const name = stated(details?.name);
    if (!name) return;
    const agent = { name, role: stated(details.role), modelSlot: stated(details.modelSlot), state };
    if (state === 'queued' && Number.isInteger(details.queuePosition)) agent.queuePosition = details.queuePosition;
    if (group) agent.group = group;
    agent[state === 'failed' ? 'endedAt' : 'startedAt'] = this.now();
    this.agents.set(name, Object.fromEntries(Object.entries(agent).filter(([, value]) => value !== undefined)));
  }

  refine(status) {
    const agent = this.agents.get(stated(status?.name));
    if (!agent || !OUT.has(agent.state) || !stated(status.phase)) return;
    agent.phase = stated(status.phase);
    agent.state = status.phase === 'queued' ? 'queued' : 'running';
    if (stated(status.activeTool)) agent.activeTool = stated(status.activeTool);
    else delete agent.activeTool;
    if (agent.state === 'queued' && Number.isInteger(status.queuePosition)) agent.queuePosition = status.queuePosition;
    else delete agent.queuePosition;
  }

  finish(agent, state) {
    if (!agent || !OUT.has(agent.state)) return;
    delete agent.queuePosition;
    delete agent.phase;
    delete agent.activeTool;
    Object.assign(agent, { state, endedAt: this.now() });
  }

  /** The session's agents. Once it has ended, one still out never reported, so how it ended is unknown: `stopped`. */
  children({ ended = false } = {}) {
    return [...this.agents.values()].map(agent => {
      if (!ended || !OUT.has(agent.state)) return { ...agent };
      const { queuePosition, phase, activeTool, ...left } = agent;
      return { ...left, state: 'stopped' };
    });
  }
}

/** Allowlisted, disposable display data; never retains harness records. */
export class JobActivity {
  entries = [];
  message = 0;
  hidden = false;

  /** `most` keeps only the latest entries, for a feed with no end such as the main chat's. */
  constructor({ now, most = Infinity } = {}) {
    this.spawned = new SpawnedAgents({ now });
    this.most = most;
  }

  accept(event) {
    try {
      this.reduce(event);
      if (this.entries.length > this.most) this.entries.splice(0, this.entries.length - this.most);
    } catch {
      /* Display data must not fail execution. */
    }
    this.spawned.accept(event);
  }

  /** The agents this run spawned. */
  children(options) { return this.spawned.children(options); }

  text(index, value, append = false) {
    if (!Number.isInteger(index) || index < 0 || typeof value !== 'string') return;
    const id = `message:${this.message}:${index}`;
    let entry = this.entries.find(item => item.id === id);
    if (!entry) {
      entry = { id, kind: 'assistant', text: '' };
      this.entries.push(entry);
    }
    const previousText = append ? entry.text : '';
    entry.text = clean(previousText + clean(value));
  }

  tool(id, name, state, input, output) {
    if (typeof id !== 'string' || !id) return;
    const key = `tool:${id}`;
    let entry = this.entries.find(item => item.id === key);
    if (!entry) {
      if (typeof name !== 'string' || !name) return;
      entry = { id: key, kind: 'tool', name: clean(name), state };
      this.entries.push(entry);
    }
    entry.state = state;
    if (input !== undefined) entry.input = inputText(input);
    if (output !== undefined) entry.output = outputText(output);
  }

  reduce(event) {
    if (!event || typeof event !== 'object') return;

    if (event.display === false) {
      if (event.type === 'message_start') {
        this.message++;
        this.hidden = true;
      } else if (event.type === 'message_update') {
        this.hidden = true;
      }
      return;
    }

    if (event.type === 'message_start') {
      this.message++;
      this.hidden = !this.visibleMessage(event.message);
    } else if (event.type === 'message_update') {
      const part = event.assistantMessageEvent;
      if (event.message?.display === false
        || part?.display === false
        || part?.content?.display === false) {
        this.hidden = true;
      }
      if (!this.hidden) {
        if (part?.type === 'text_delta') this.text(part.contentIndex, part.delta, true);
        if (part?.type === 'text_end') this.text(part.contentIndex, part.content);
      }
    } else if (event.type === 'message_end') {
      if (!this.hidden
        && this.visibleMessage(event.message)) {
        const content = typeof event.message.content === 'string' ? [{ type: 'text', text: event.message.content }] : event.message.content;
        if (!Array.isArray(content)) return;
        const ids = new Set(content.flatMap((part, index) =>
          part?.type === 'text' && part.display !== false ? [`message:${this.message}:${index}`] : []));
        this.entries = this.entries.filter(entry =>
          !entry.id.startsWith(`message:${this.message}:`) || ids.has(entry.id));
        content.forEach((part, index) => {
          if (part?.display === false) return;
          if (part?.type === 'text') this.text(index, part.text);
          if (part?.type === 'toolCall') this.tool(part.id, part.name, 'running', part.arguments);
        });
      }
      this.message++;
      this.hidden = false;
    } else if (['tool_execution_start', 'tool_execution_update'].includes(event.type)) {
      this.tool(event.toolCallId, event.toolName, 'running', event.args, event.partialResult);
    } else if (event.type === 'tool_execution_end') {
      this.tool(event.toolCallId, event.toolName, event.isError ? 'failed' : 'completed', undefined, event.result);
    }
  }

  visibleMessage(message) {
    return message?.display !== false && (message?.role === 'assistant'
      || (message?.role === 'custom' && message.display === true));
  }

  snapshot() { return this.entries.map(entry => ({ ...entry })); }
}
