# Sisyphos

## Where facts live

| Kind                                                             | Home                 |
| ---------------------------------------------------------------- | -------------------- |
| What the app is, how to run it, the top-level layout             | `README.md`          |
| Why a design was chosen, what was rejected, hosting              | `docs/DESIGN.md`     |
| The log repo's files: layout, ids, serialisation, columns, setup | `docs/DATA.md`       |
| What the lifter is told about keeping their data safe            | `docs/DURABILITY.md` |
| Why each muscle group covers what it does                        | `docs/MUSCLES.md`    |
| Screens not built yet, pruned section by section as each ships   | `docs/UI.md`         |
| How anything works                                               | The code             |

The exercises and muscle groups are `src/library/exercises.csv` and
`muscles.csv`. Where a doc disagrees with them, the CSV is right and the doc is
fixed. They are curated by hand: propose changes to them rather than making
them.

Code cites a doc by file and heading (`DATA.md, Serialisation`), never by section
number, so a doc can be reorganised without breaking its citations.

## Working here

- The GitHub token is never logged, echoed or committed.
- `npm run smoke` needs a token only the maintainer has: ask them to run it.
