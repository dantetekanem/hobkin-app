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

const refusal = (name, known) => known.length
  ? `No skill named "${name}" is offered to you. You can load: ${known.map(skill => skill.name).join(', ')}.`
  : `No skill named "${name}" is offered to you, and you are offered no skills.`;

/**
 * `load_skill { name }`: the skill's SKILL.md without its front matter, after its name and folder. `skills()` gives
 * Pi's own list for this agent, so the tool adds no skill: a name not on it is refused.
 */
export function createLoadSkillTool(skills) {
  return {
    name: LOAD_SKILL,
    label: 'Load skill',
    description,
    parameters,
    async execute(_id, { name }) {
      const known = offered(skills());
      const skill = known.find(item => item.name === name);
      if (!skill) throw Error(refusal(name, known));

      const instructions = stripFrontmatter(readFileSync(skill.filePath, 'utf8')).trim();
      return {
        content: [{ type: 'text', text: `Skill: ${skill.name}\nFolder: ${skill.baseDir}\n\n${instructions}` }],
        details: { name: skill.name, folder: skill.baseDir },
      };
    },
  };
}

const xml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Pi's list of skills for the system prompt, with each to be loaded by name rather than read from its file. */
const skillsSection = skills => [listLead, '', '<available_skills>',
  ...skills.flatMap(skill => ['  <skill>', `    <name>${xml(skill.name)}</name>`, `    <description>${xml(skill.description)}</description>`, '  </skill>']),
  '</available_skills>'].join('\n');

/**
 * Registers `load_skill` and returns it. Each turn, as it begins, the tool takes the skills Pi lists for it, and Pi's
 * list in the prompt says to load them with the tool. An extension that sets the whole prompt from what it is given
 * sees that list only if it comes later, so the main chat's extension calls this before it adds its own sections.
 */
export default function loadSkill(pi) {
  let skills = [];
  const tool = createLoadSkillTool(() => skills);
  pi.registerTool(tool);
  pi.on('before_agent_start', event => {
    skills = event.systemPromptOptions.skills ?? [];
    const visible = offered(skills);
    if (visible.length && pi.getActiveTools().includes(LOAD_SKILL)) event.systemPromptOptions.sections.skills = skillsSection(visible);
  });
  return tool;
}
