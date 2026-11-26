/** The runtime reserves the session; Pi owns interception, execution and native history. */
export function attachUserBash(session) {
  session.executeUserBash = async (command, { id, onChunk } = {}) => {
    const intercepted = await session.extensionRunner.emitUserBash({
      type: 'user_bash', command, excludeFromContext: false, cwd: session.sessionManager.getCwd(),
    });
    if (intercepted?.result) {
      session.recordBashResult(command, intercepted.result);
      return intercepted.result;
    }
    return session.executeBash(command, onChunk, { id, operations: intercepted?.operations });
  };
  return session;
}
