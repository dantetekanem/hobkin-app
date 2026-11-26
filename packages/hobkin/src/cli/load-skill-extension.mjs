import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

/**
 * The path hobkin loads with `--extension` into every run with tools (`namingExtensions` in `harnesses.mjs`). The main
 * chat's own extension registers the tool itself (`hobkin-extension.mjs`). 070-load-skill.
 */
export const loadSkillExtension = fileURLToPath(import.meta.url);
export const LOAD_SKILL = 'load_skill';

const promptText = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').trim();
const description = promptText('load-skill-tool');
const listLead = promptText('skills-list');

const parameters = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200, description: "The skill's name, as your list of skills gives it." }),
}, { additionalProperties: false });

// A skill marked `disable-model-invocation` is one only the user starts, so Pi does not offer it to the model.
const offered = skills => skills.filter(skill => !skill.disableModelInvocation);

function refusal(name, known) {
  const notOffered = `No skill named "${name}" is offered to you`;
  if (!known.length) return `${notOffered}, and you are offered no skills.`;

  return `${notOffered}. You can load: ${known.map(skill => skill.name).join(', ')}.`;
}

/**
 * `load_skill { name }`: the skill's SKILL.md without its front matter, after its name and folder. `offeredSkills()`
 * gives the skills Pi offers this agent, so the tool adds no skill: a name not among them is refused.
 */
export function createLoadSkillTool(offeredSkills) {
  return {
    name: LOAD_SKILL,
    label: 'Load skill',
    description,
    parameters,
    async execute(_id, { name }) {
      const known = offeredSkills();
      const skill = known.find(item => item.name === name);
      if (!skill) throw Error(refusal(name, known));

      const instructions = stripFrontmatter(readFileSync(skill.filePath, 'utf8')).trim();
      const text = [`Skill: ${skill.name}`, `Folder: ${skill.baseDir}`, '', instructions].join('\n');
      return {
        content: [{ type: 'text', text }],
        details: { name: skill.name, folder: skill.baseDir },
      };
    },
  };
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = text => text.replace(/[&<>"']/g, char => XML_ESCAPES[char]);

const skillEntry = skill => [
  '  <skill>',
  `    <name>${xml(skill.name)}</name>`,
  `    <description>${xml(skill.description)}</description>`,
  '  </skill>',
];

/** Pi's list of skills for the system prompt, with each to be loaded by name rather than read from its file. */
const skillsSection = skills => [
  listLead,
  '',
  '<available_skills>',
  ...skills.flatMap(skillEntry),
  '</available_skills>',
].join('\n');

/**
 * Registers `load_skill` and returns it. Each turn, as it begins, the tool takes the skills Pi offers it, and Pi's list
 * in the prompt says to load them with the tool. An extension that sets the whole prompt from what it is given sees
 * that list only if it comes later, so the main chat's extension calls this before it adds its own sections.
 */
export default function loadSkill(pi) {
  let offeredSkills = [];
  const tool = createLoadSkillTool(() => offeredSkills);
  pi.registerTool(tool);

  pi.on('before_agent_start', event => {
    offeredSkills = offered(event.systemPromptOptions.skills ?? []);
    const listsThem = offeredSkills.length > 0 && pi.getActiveTools().includes(LOAD_SKILL);
    if (listsThem) event.systemPromptOptions.sections.skills = skillsSection(offeredSkills);
  });
  return tool;
}
