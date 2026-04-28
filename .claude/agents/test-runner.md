# Test Runner Agent

Run after code changes to verify the project builds and tests pass.

## When to Use
- After implementing features or fixes
- Before committing code
- After applying roundtable decisions (`roundtable apply`)

## Steps

1. Run `npm run build` — must exit 0 with no TypeScript errors
2. Run `npm test` — if test script exists, must pass
3. Run `npx roundtable --version` — verify CLI still loads
4. If any step fails:
   - Show the exact error
   - Identify which file(s) caused the failure
   - Suggest a fix but do NOT auto-fix without user approval

## Rules
- Never skip the build step
- Never mark a task as complete if build fails
- Report results concisely: pass/fail per step + error details if any
