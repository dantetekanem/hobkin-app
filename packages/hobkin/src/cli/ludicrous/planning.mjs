import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_FILE, readPlan } from './areas.mjs';
import { taskPrompt } from './prompts.mjs';

/**
 * Ludicrous planning (076, Planning): five planners, each with one lens, plan the user's idea in four rounds and never talk to each other.
 * They discuss through files under `_specs/ludicrous/planning/`, each writing only its own. Round 1 is a draft each; round 2 each reads all
 * five and writes its critique and revision; in round 3 the delivery planner writes the plan, then each planner writes the specs of the areas
 * the plan gives it; in round 4 each checks the whole set against its lens, then the delivery planner settles what they raised. A task is owed
 * while a file it writes is missing, so a run stopped in planning plans again from the files already there.
 */

export const LENSES = Object.freeze([
  { id: 'product', looks: 'who uses it and what they do' },
  { id: 'architecture', looks: 'the stack, the boundaries and the contracts between the areas' },
  { id: 'data', looks: 'the data and its state: the models, the state machines, and TLA+ where a machine matters' },
  { id: 'quality', looks: 'the tests, the proof, the monitoring and the run guide' },
  { id: 'delivery', looks: 'the areas, the waves, and packets sized so the tier stays busy' },
]);
export const PLANNERS = LENSES.length;
const PLANNING = '_specs/ludicrous/planning';
const draft = (round, lens) => `${PLANNING}/round-${round}/${lens}.md`;
const SETTLED = `${PLANNING}/round-4/settled.md`;
const ANSWERED = `${PLANNING}/answers.md`;

/** The steps of planning in order. `answers` runs only when the user's answers change what the planners picked. */
const STEPS = ['drafts', 'critiques', 'plan', 'specs', 'checks', 'settle'];
export const ROUND_OF = { drafts: 1, critiques: 2, plan: 3, specs: 3, checks: 4, settle: 4, answers: 'answers' };

const filled = (folder, path) => existsSync(join(folder, path)) && readFileSync(join(folder, path), 'utf8').trim().length > 0;

/** The plan, or why it cannot be read yet: what the delivery planner is told when it writes it again. */
function planOrWhy(folder) {
  try {
    return { plan: readPlan(folder), why: null };
  } catch (error) {
    return { plan: null, why: error.message };
  }
}

// Which planner writes each area's spec: the one the plan names, or else they take turns, so each spec has one writer.
const writerOf = (area, index) => (LENSES.some(lens => lens.id === area.writer) ? area.writer : LENSES[index % PLANNERS].id);
export const specsOf = (plan, lens) => plan.areas.filter((area, index) => writerOf(area, index) === lens).map(area => `_specs/${area.id}/spec.md`);

function owed(folder, step) {
  const all = path => LENSES.map(lens => ({ lens: lens.id, writes: [path(lens.id)] }));
  switch (step) {
    case 'drafts': return all(lens => draft(1, lens));
    case 'critiques': return all(lens => draft(2, lens));
    case 'plan': return [{ lens: 'delivery', writes: [PLAN_FILE, '_specs/ludicrous/plan.md', '_specs/ludicrous/questions.md'] }];
    case 'specs': {
      const { plan } = planOrWhy(folder);
      return plan ? LENSES.map(lens => ({ lens: lens.id, writes: specsOf(plan, lens.id) })).filter(task => task.writes.length) : [];
    }
    case 'checks': return all(lens => draft(4, lens));
    case 'settle': return [{ lens: 'delivery', writes: [SETTLED] }];
    case 'answers': return [{ lens: 'delivery', writes: [ANSWERED] }];
    default: throw Error(`Planning has no step ${step}.`);
  }
}

const answersText = (plan, answers) => (plan?.questions ?? []).map(question => {
  const id = answers[question.id] ?? question.pick;
  const option = question.options.find(each => each.id === id);
  return `- ${question.id}. ${question.question} The user's answer: ${option?.label ?? id}${answers[question.id] ? '' : ' (your pick, left as it was)'}.`;
}).join('\n');

/** The prompt one planner gets for one step: the idea, its lens, and exactly which files to read and to write. */
function promptFor(folder, run, step, { lens, writes }) {
  const { looks } = LENSES.find(each => each.id === lens);
  const { plan, why } = planOrWhy(folder);
  return taskPrompt('ludicrous-rounds', step, {
    idea: run.idea, name: run.name, lens, looks, writes: writes.map(path => `- ${path}`).join('\n'),
    planning: PLANNING, tier: run.tier,
    redo: why && step === 'plan' && filled(folder, PLAN_FILE) ? `The plan in ${PLAN_FILE} cannot be built from yet: ${why} Write it again so it can.` : '',
    answers: step === 'answers' ? answersText(plan, run.answers ?? {}) : '',
  });
}

/**
 * What planning still owes at the run's step, and the step after it once nothing is owed: tasks for the planners not yet done, each with
 * the files it writes and its prompt. After `settle` the plan is ready, and after `answers` the run builds.
 */
export function planningTasks(folder, run) {
  const step = run.step ?? 'drafts';
  const plan = planOrWhy(folder);
  const tasks = owed(folder, step).filter(task => task.writes.some(path => !filled(folder, path)) || (step === 'plan' && plan.why))
    .map(task => ({ key: `${step}:${task.lens}`, step, ...task, prompt: promptFor(folder, run, step, task) }));
  const next = step === 'answers' ? 'building' : step === 'settle' ? 'plan-ready' : STEPS[STEPS.indexOf(step) + 1];
  return { step, round: ROUND_OF[step], tasks, next };
}

/** Whether the user's answers differ from any pick, so the plan needs the short `answers` step before building. */
export function answersChangePlan(folder, answers = {}) {
  const { plan } = planOrWhy(folder);
  return (plan?.questions ?? []).some(question => answers[question.id] !== undefined && answers[question.id] !== question.pick);
}

/** The areas and questions the page shows with a plan that is ready. */
export function planView(folder) {
  const { plan } = planOrWhy(folder);
  if (!plan) return null;
  return {
    areas: plan.areas.map(({ id, name, depends = [], summary = null }) => ({ id, name, depends, summary })),
    questions: (plan.questions ?? []).map(({ id, question, options, pick, why = null }) => ({ id, question, options, pick, why })),
  };
}
