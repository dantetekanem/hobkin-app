import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { listActionItems, dismissActionItems } from './pending-read.mjs';
import { actionParameters } from './action-parameters.mjs';

export function createActionItemTool(root) {
  const { parameters, refusal } = actionParameters({
    list: {},
    dismiss: { id: Type.String({ minLength: 1, maxLength: 512, pattern: '\\S' }) },
    dismiss_all: {},
  });
  return defineTool({
    name: 'hobkin_action_items',
    label: 'List or dismiss Action Items',
    description: 'Use list to see current Action Items with IDs, groups and titles. Only on explicit user request, use dismiss with one exact listed ID or dismiss_all for all items currently visible. Returns dismissed and remaining counts. Dismissal hides cards without answering them, approving anything or starting work. New arrivals still appear.',
    parameters,
    async execute(_id, request, signal) {
      if (!Check(parameters, request)) throw Error('Invalid Action Item request. Choose list, dismiss with an exact id, or dismiss_all.');
      const unfit = refusal(request);
      if (unfit) throw Error(`Invalid Action Item request. ${unfit}`);
      signal?.throwIfAborted();
      if (!root) throw Error('Action Items are unavailable.');
      const details = request.action === 'list'
        ? listActionItems(root)
        : dismissActionItems(root, request.action === 'dismiss' ? { id: request.id } : { all: true });
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}
