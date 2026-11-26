import { Type } from 'typebox';

const listed = (names, last) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`);

/**
 * Parameters for a tool whose fields depend on its action, as one object at the root. A union of one object per action
 * puts anyOf at the root, and Gemini refuses any request that carries such a tool. So `action` is a union of literals,
 * every other field is optional, and `refusal` keeps what the union checked per action. `actions` maps each action to
 * its fields as the union's object had them, with `Type.Optional` on a field the action may leave out. A field that
 * several actions take has the same schema in each.
 */
export function actionParameters(actions) {
  const fields = {};
  for (const shape of Object.values(actions)) {
    for (const [name, schema] of Object.entries(shape)) fields[name] ??= Type.IsOptional(schema) ? schema : Type.Optional(schema);
  }
  const parameters = Type.Object({ action: Type.Union(Object.keys(actions).map(action => Type.Literal(action))), ...fields },
    { additionalProperties: false });
  /** The fields a request's action needs and lacks, or has and does not take, in plain words; '' when there are none. */
  const refusal = request => {
    const shape = Object.hasOwn(actions, request?.action) ? actions[request.action] : null;
    if (!shape) return '';
    const missing = Object.keys(shape).filter(name => !Type.IsOptional(shape[name]) && !Object.hasOwn(request, name));
    const extra = Object.keys(request).filter(name => name !== 'action' && !Object.hasOwn(shape, name));
    return [
      missing.length ? `The ${request.action} action needs ${listed(missing, 'and')}.` : '',
      extra.length ? `The ${request.action} action does not take ${listed(extra, 'or')}.` : '',
    ].filter(Boolean).join(' ');
  };
  return { parameters, refusal };
}
