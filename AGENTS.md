# Peerly

README.md and docs/ describe the app; `.github/workflows/ci.yml` is what CI runs.
Read docs/MAP.md before exploring; update it when you move or add something it names.

- Merging: once the PR's pre-PR passes are done and CI is green, add the `automerge` label
  (`gh pr edit <n> --add-label automerge`). It merges itself with a merge commit as soon as every check
  is green, as the codefusion-automerge App, so the deploys on `main` still run; PRs stacked on it move onto
  `main` (codefusion-cc/codefusion `automerge/README.md`). A branch the ruleset wants up to date is brought up to date
  first and merges once its checks pass again. Leave the label off a PR that must wait for something
  else, and never run `gh pr merge` yourself.
