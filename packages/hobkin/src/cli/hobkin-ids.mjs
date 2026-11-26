/**
 * How a durable hobkin's turns are named (`hobkins.mjs`). A turn is a run, and other parts of hobkin have to tell it
 * from a routine's or a session's run by its id alone. The shapes are exact, so a routine the user names `hobkin` or
 * `hobkin.something` is never taken for one.
 */

/** The run of a hobkin's nth turn. */
export const turnRunId = (id, n) => `hobkin:${id}:${n}`;

/** The schedule id every turn of a hobkin runs under. */
export const turnSchedule = id => `hobkin.${id}`;

const TURN_RUN = /^hobkin:[0-9a-f]{8}:\d+$/;

/** True for the id of a durable hobkin's turn, and for nothing else. */
export const isTurnRunId = id => TURN_RUN.test(String(id));
