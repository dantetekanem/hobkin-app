---
name: ludicrous-compile
description: The format of a Ludicrous mode run's report, which becomes its pull request's description. Load it before writing the report.
---

# The run's report

The report is what the user reads first about the run, and the pull request's description. Keep it short at the top, and put the detail in a details block.

```markdown
<One paragraph: what the run built, whether the suite passes on the branch head, and what is left.>

| Area | Steps done | Proven | Left |
| --- | --- | --- | --- |
| Foundation | 6 of 6 | 6 | nothing |
| API | 4 of 9 | 4 | the users routes, paging |

<details><summary>How it was checked</summary>

- The commands you ran on the branch head, and what each gave.
- What hobkin counted: agents, time and tokens, as your task gives them.
- The unfinished work saved as patches, packet by packet.

</details>
```

"Proven" counts the steps whose proof passed in the suite you ran. Never count a step whose proof did not run.
