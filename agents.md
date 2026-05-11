## Required TypeScript / Build Discipline

Before completing any PR, run the repository's validation commands, including:

- `npm install` if dependencies are missing
- `npm run typecheck` if available
- `npm run build`

A PR is not complete unless the TypeScript check and production build pass.

If TypeScript errors appear:

1. Fix all TypeScript errors caused by the current change.
2. Fix pre-existing TypeScript errors when they are small, obviously safe, or directly blocking the build/deploy.
3. Do not ignore TypeScript errors just because they came from an earlier PR.
4. Do not perform large unrelated rewrites just to clear old errors unless they are necessary for the requested task.
5. If old TypeScript errors remain and are too risky or broad to fix within the PR, document them clearly in `nextSteps.md` with:
   - the exact command that failed
   - the exact error message
   - the file and line number
   - the likely cause
   - a recommended fix

Never claim the task is complete if the build is failing.

## GitHub Pages Deployment Rule

Because this project deploys to GitHub Pages, the final implementation must preserve a passing production build. Any change that prevents `npm run build` from completing successfully should be treated as incomplete.

If the requested feature works locally but the production build fails, prioritize fixing the build before adding more features.
