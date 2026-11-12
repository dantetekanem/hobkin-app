import { efforts } from './schedules.mjs';

/**
 * The tiers hobkin delegates by: a job names the tier its work needs, never a model. A tier is a model and an effort
 * the user picks, kept in `config.json` under `tiers`. One that is not set follows a model hobkin already has: `fast`
 * the checks model, since it collects and searches, and the others the chat model, since they write what gets merged.
 */
export const tierNames = ['fast', 'mid', 'high', 'max'];

/** What each tier is for, in the words the command and the main agent's prompt use. */
export const tierUses = {
  fast: 'collecting, searching and small mechanical edits',
  mid: 'ordinary features, fixes, reviews and checks',
  high: 'work that spans a system or needs careful analysis',
  max: 'rare, high-risk work on security, data or recovery, and only when the user asks for it by name',
};

/**
 * The two tiers a change review uses: the Reviewer builds it, reading the change and rating its risk, and Quick checks
 * the finished review once. Each names one of the four tiers, kept in `config.json` under `review`.
 */
export const reviewRoles = ['reviewer', 'quick'];
const defaultReview = { reviewer: 'high', quick: 'fast' };

export function validateReview(review) {
  if (review === undefined) return review;
  const named = review && typeof review === 'object' && !Array.isArray(review) && Object.keys(review).every(role => reviewRoles.includes(role));
  if (!named) throw Error('review names a tier for reviewer and quick, and nothing else');
  for (const tier of Object.values(review)) assertTier(tier);
  return review;
}

/** The tier each review role runs on now: the one the user named, or its default. */
export const reviewTiers = config => ({ ...defaultReview, ...config.review });

/** Work that names no tier is ordinary work. */
const DEFAULT_TIER = 'mid';

export const TIER_NEEDED = `Name the tier this job needs with --tier: ${tierNames.map(name => `${name} for ${tierUses[name]}`).join('; ')}.`;

export function assertTier(tier) {
  if (!tierNames.includes(tier)) throw Error(`tier must be one of ${tierNames.join(', ')}`);
  return tier;
}

export function validateTiers(tiers) {
  if (tiers === undefined) return tiers;
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) throw Error('tiers must name a model and an effort for each tier');
  for (const [name, setting] of Object.entries(tiers)) {
    assertTier(name);
    if (setting === null) continue;
    if (typeof setting?.model !== 'string' || !/^[^/\s]+\/\S+$/.test(setting.model) || setting.model.length > 200) throw Error(`the ${name} tier needs a model as provider/model`);
    if (!efforts.pi.includes(setting.effort)) throw Error(`the ${name} tier has an unsupported effort`);
  }
  return tiers;
}

/**
 * The model and effort a job on `tier` runs with. `follows` says whose they are when the tier itself is not set:
 * `background` or `main`, and null for a tier with a model of its own.
 */
export function tierBinding(config, tier) {
  const name = tierNames.includes(tier) ? tier : DEFAULT_TIER;
  const own = config.tiers?.[name];
  if (own?.model) return { tier: name, model: own.model, effort: own.effort, follows: null };
  const follows = name === 'fast' ? 'background' : 'main';
  return { tier: name, model: config[follows].model, effort: config[follows].effort, follows };
}
