---
title: Dependency watch
summary: Outdated or vulnerable packages in a project, and the upgrade that fixes each one.
recurrence: Weekly
goals: code
effort: medium
fits: Someone who maintains a project and wants to hear about vulnerable or outdated packages without checking by hand.
tells: A package with a known vulnerability, or one that fell behind, with the upgrade that fixes it.
gives: report
closes: The upgrade landing in the project, or their word.
asks: Which project should it watch?
---

In <the project folder>, use the package manager's own commands, such as <its outdated and audit commands>, to find packages that are outdated or have a known vulnerability. For each one, give the upgrade that fixes it: the version to move to, and whether it is a major upgrade. Put vulnerable packages first.
