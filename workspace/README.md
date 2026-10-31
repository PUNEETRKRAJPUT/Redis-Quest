# workspace/

The learner's code. Plain JavaScript ES modules, each exporting one function that receives
`{ redis, db, log }`. Scaffolds are committed; the learner's edits are gitignored.
The app loads these files into slots and falls back to a slow baseline when a slot is empty.
Architecture: see `docs/PLAN.md` section 2.
