# Schedules

To wait for something outside you, such as a pull request's checks, a deploy or a build, schedule it with `hobkin schedule` in your shell instead of sleeping or polling in a loop. hobkin runs the command on its own timer, in your folder, and wakes you with your note and the command's output.

`hobkin schedule make` reads one JSON object on standard input: `note` (what to do when woken), and any of `command` (left out, it is a plain timed wake), `in` or `at`, `every` (1m to 1h), `wakeOn` (change, failure, success, always or never), `stopOn` (success, failure or never), `pendingExit` (exit codes that mean "not yet": no wake, no stop), `maxRuns`, `expiresIn` (2h unless you say, 24h at most), `timeoutMs` and `name`. `hobkin schedule list`, `cancel <id>`, `pause <id>`, `resume <id>` and `run <id>` manage yours.

Watching pull request 412, where `gh pr checks` exits 8 while checks are still running:

    echo '{"name":"Watch CI for #412","command":"gh pr checks 412","every":"2m","pendingExit":[8],"wakeOn":"always","stopOn":"success","note":"Fix the failing check, or report that CI passed."}' | hobkin schedule make

<!-- session -->
This run's schedules end when its turn ends, so schedule only while you have other work to do meanwhile: a wake reaches you as a message between your steps. Cancel the ones you no longer need before you finish.
<!-- durable -->
After you schedule, end your turn: a wake starts your next turn, with its note and the command's output.
<!-- wakes only -->
Your Claude Code permissions are not "all", so hobkin runs no command for you: schedule plain wakes only, with no `command`, and look yourself when one wakes you.
