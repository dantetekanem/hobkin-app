// Extension code in the Pi child reaches Hobkin through an RPC input dialog with this title,
// so the only channel is the child's own stdio pipe; nothing listens on a socket or in the environment.
export const BRIDGE = 'hobkin/bridge';
const MAX_REQUEST_BYTES = 1048576;

/** Child side. Resolves the host's result or throws its error. */
export async function callBridge(ctx, request, signal) {
  if (ctx?.mode !== 'rpc') throw Error('Hobkin tools run only under a Hobkin host.');
  const answer = await ctx.ui.input(BRIDGE, JSON.stringify(request), { signal });
  if (answer === undefined) throw Error(signal?.aborted ? 'Cancelled.' : 'The Hobkin host did not answer.');
  const reply = JSON.parse(answer);
  if (!reply.ok) throw Error(reply.error);
  return reply.result;
}

/** Host side. A request can only run a tool the host registered, under that tool's own validation. */
export async function serveBridge(placeholder, { tools, memory, memories = () => '', directions, decided, persona = () => 'Normal' }, signal) {
  try {
    if (typeof placeholder !== 'string' || Buffer.byteLength(placeholder) > MAX_REQUEST_BYTES) throw Error('Invalid bridge request.');
    const request = JSON.parse(placeholder);
    if (request?.op === 'persona') return { ok: true, result: persona() };
    if (request?.op === 'memory') return { ok: true, result: memory() };
    // hobkin's memories as an index for the prompt (057-shared-memory), empty when there are none.
    if (request?.op === 'memories') return { ok: true, result: memories() };
    if (request?.op === 'directions') return { ok: true, result: directions() };
    if (request?.op === 'decided') return { ok: true, result: decided() };
    if (request?.op !== 'tool' || !Object.hasOwn(tools, request.name)
      || typeof request.id !== 'string' || !request.id || request.id.length > 200
      || !request.params || typeof request.params !== 'object') {
      throw Error('Invalid bridge request.');
    }
    return { ok: true, result: await tools[request.name].execute(request.id, request.params, signal) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
