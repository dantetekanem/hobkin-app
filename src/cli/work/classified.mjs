/**
 * What a review says of a finished change, beside its grade: five scores from 1 to 10, each with a line of evidence, and the kind of change it is.
 * The review sends the scores and hobkin works out the rest here, so no run can send a rate. A score says how well a question is answered, and
 * never how risky the change is: that is the review's level.
 */

/** The five questions, in the order a card says them. */
export const CRITERIA = ['coverage', 'proof', 'safety', 'visibility', 'rollback'];
export const KINDS = ['performance', 'bug-fix', 'state-machine', 'package-update', 'small-change', 'feature', 'unclear'];
/** The kinds small enough to merge by themselves. A feature, and anything a review could not place, keeps asking the user. */
export const SMALL_KINDS = KINDS.slice(0, 5);

// A deploy or data risk is the harm an average hides, a regression the monitoring would not show goes unseen, and a change that is slow to undo
// needs a person.
const FLOORS = { safety: 8, visibility: 7, rollback: 7 };
// A 4 or less means the review found that part missing or wrong.
const LOWEST = 5;
// A model hobkin checked broke at the change's head, so the proof it was given shows the change wrong.
const BROKEN_MODEL_PROOF = 3;
const COMMIT = /^[0-9a-f]{40}$/;
const LONGEST_LINE = 400;

const isScore = score => Number.isInteger(score) && score >= 1 && score <= 10;
const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && text.length <= LONGEST_LINE && !/[\r\n]/.test(text.trim());

/** Refuses a review hobkin could not stand behind, saying which part is wrong. */
export function assertReview(review) {
  const { kind, scores, head, missing, rate } = review ?? {};
  if (!KINDS.includes(kind)) throw Error(`A review's kind must be one of: ${KINDS.join(', ')}`);
  if (!COMMIT.test(head ?? '')) throw Error('A review needs head, the full commit it read, as git rev-parse HEAD prints it.');
  if (rate !== undefined) throw Error('A review sends no rate: hobkin works it out from the scores.');
  for (const criterion of CRITERIA) {
    const { score, evidence } = scores?.[criterion] ?? {};
    if (!isScore(score)) throw Error(`${criterion} needs a whole score from 1 to 10.`);
    if (!isOneLine(evidence)) throw Error(`${criterion} needs one line of evidence, at most ${LONGEST_LINE} characters.`);
  }
  if (missing !== undefined && !isOneLine(missing)) throw Error('missing is one line saying what proof is still wanted, or left out.');
}

/** A review as hobkin keeps it: only what it asked for, checked. */
export function keptReview(review) {
  assertReview(review);
  const { kind, scores, head, missing } = review;
  const kept = Object.fromEntries(CRITERIA.map(criterion => [criterion, { score: scores[criterion].score, evidence: scores[criterion].evidence.trim() }]));
  return { kind, scores: kept, head, ...(missing ? { missing: missing.trim() } : {}) };
}

/** The average of the five, cut to one decimal and never rounded up. */
export function generalRate(scores) {
  const sum = CRITERIA.reduce((total, criterion) => total + scores[criterion].score, 0);
  return Math.floor((sum * 10) / CRITERIA.length) / 10;
}

/** The scores that hold a change whatever its average, each with what it needed. */
export const brokenFloors = scores => CRITERIA
  .map(criterion => ({ criterion, score: scores[criterion].score, needs: FLOORS[criterion] ?? LOWEST }))
  .filter(({ score, needs }) => score < needs);

/**
 * The scores with what hobkin's own model checks at the change's head say (`modelFacts` in `proofs.mjs`). Once any model ran there, the proof
 * score's evidence is those runs and marked as hobkin's, and a model that broke there leaves it at 3 at most. A model nobody ran is no evidence.
 */
export function withModelChecks(scores, models = []) {
  const ran = models.filter(({ run }) => run);
  if (!ran.length) return scores;
  const broken = ran.find(({ state }) => state === 'broken');
  const { score } = scores.proof;
  const proof = {
    score: broken ? Math.min(score, BROKEN_MODEL_PROOF) : score,
    evidence: ran.map(({ line }) => line).join('; ').slice(0, LONGEST_LINE),
    by: 'hobkin',
    run: (broken ?? ran[0]).run,
  };
  return { ...scores, proof };
}

/** A kept review with what hobkin works out from it, and from its own model checks at the change's head. */
export function scoresOf({ kind, scores: reviewed, head, missing = null }, models = []) {
  const scores = withModelChecks(reviewed, models);
  return { kind, scores, rate: generalRate(scores), floors: brokenFloors(scores), missing, head };
}
