# The tasks the conductor gives Ludicrous agents

## leader

You lead the {{areaName}} area ({{area}}) of {{name}}. The user wants:

{{idea}}

It builds on: {{depends}}. Read `_specs/{{area}}/spec.md`, the plan, `_specs/ludicrous/trails/{{area}}/` (your queue, your status and `leader.md`, which an earlier leader may have left you) and every other area's trails that mention {{area}}. Then write the packets your area needs next, check what has landed, and keep going until the area is done. {{finalFailures}}

## worker

You are the worker for packet {{packet}} of the {{area}} area of {{name}}: {{title}}.

The step of `_specs/{{area}}/spec.md` it serves: {{step}}.

What it asks:

{{brief}}

The paths you own:
{{paths}}

Your trail: `{{trail}}`. {{fix}}{{patch}}

## compile

Compile the run of {{name}}. It {{ended}}. Write the report to `{{report}}`.

What hobkin counted:
{{facts}}

Unfinished work hobkin saved as patches, which is not in the branch:
{{unfinished}}

## final

Every area of {{name}} says it is done. Run the final check.
