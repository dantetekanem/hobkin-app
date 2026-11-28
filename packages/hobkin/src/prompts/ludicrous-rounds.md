# The planners' tasks, one for each step of planning

## drafts

Round 1 of planning {{name}}. The user wants:

{{idea}}

Your lens is {{lens}}: {{looks}}. Write your draft of the whole plan through that lens: what the project is, how it should be built, the parts it falls into, the risks, and the choices only the user can make. A draft that names a choice also says which way you would pick and why.

Write this file, and nothing else:
{{writes}}

## critiques

Round 2 of planning {{name}}. The user wants:

{{idea}}

Your lens is {{lens}}: {{looks}}. Read all five drafts in `{{planning}}/round-1/`. Write your critique of the other four, where they are wrong, thin or in conflict, and then your revised plan through your lens, taking in what they got right.

Write this file, and nothing else:
{{writes}}

## plan

Round 3 of planning {{name}}. You are the delivery planner. The user wants:

{{idea}}

Read the five drafts in `{{planning}}/round-1/` and the five revisions in `{{planning}}/round-2/`. Settle one plan from them. Write the plan for people in `plan.md`: the idea, the areas with what each builds and what it depends on, the waves, the contracts between areas, and what done means. Write the same plan for hobkin in `plan.json`, in the skill's format: every area with its id, name, dependencies, the planner who writes its spec, its check commands, and, for the foundation, the manifests and lockfiles its leader owns. Write the questions for the user in `questions.md` and in `plan.json`, only those whose answer changes the path, each with your pick.

The plan opens with a foundation area: the repository's skeleton, the build, the test runner, the lint, the run guide, and the contracts the other areas build on. Every other area builds on it. Size the areas so {{tier}} agents at once stay busy once the foundation's contracts are committed. {{redo}}

Write these files, and nothing else:
{{writes}}

## specs

Round 3 of planning {{name}}. The user wants:

{{idea}}

Your lens is {{lens}}: {{looks}}. Read the plan in `_specs/ludicrous/plan.md` and `_specs/ludicrous/plan.json`, and the revisions in `{{planning}}/round-2/`. The plan gives you the areas below. Write one spec for each, in the skill's spec format, complete enough that the area's leader can split it into packets without asking anything: its outcome, its decisions and contracts, what is out of scope, acceptance lines anyone can check, a proof for each, and the steps in order. Name its check commands in its decisions, as the plan gives them.

Write these files, and nothing else:
{{writes}}

## checks

Round 4 of planning {{name}}. The user wants:

{{idea}}

Your lens is {{lens}}: {{looks}}. Read the whole set: `_specs/ludicrous/plan.md`, `_specs/ludicrous/plan.json`, `_specs/ludicrous/questions.md`, and every area's spec the plan names. Check it all against your lens. List what is missing, wrong, unprovable or in conflict, each with the file, the line and what it should say. Say "Nothing to raise" when the set holds.

Write this file, and nothing else:
{{writes}}

## settle

Round 4 of planning {{name}}. You are the delivery planner. Read the five checks in `{{planning}}/round-4/`. Settle each point raised: change the plan, the questions or an area's spec where the point holds, and say why where it does not. Every spec you change keeps the skill's format, and `plan.json` stays valid.

Write this file, and change only the plan, the questions and the area specs it lists:
{{writes}}

## answers

The user approved the plan for {{name}} and answered the planners' questions:

{{answers}}

You are the delivery planner. Where an answer differs from your pick, change the plan, `plan.json`, the questions and every area spec the answer touches, so the whole set follows the user's answers. Then write what you changed and why.

Write this file, and change only the plan, the questions and the area specs it lists:
{{writes}}
