# Sisyphos

## Where facts live

| Kind                                                                  | Home                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------- |
| What the app is, how to run it, the top-level layout                  | `README.md`                                           |
| Why a design was chosen, what was rejected, hosting                   | `docs/DESIGN.md`                                      |
| The log repo's files: layout, ids, serialisation, columns, setup      | `docs/DATA.md`                                        |
| What the lifter is told about keeping their data safe                 | `docs/DURABILITY.md`                                  |
| What each muscle group covers (the ids are `src/library/muscles.csv`) | `docs/MUSCLES.md`                                     |
| Screens not built yet                                                 | `docs/UI.md`, pruned section by section as each ships |
| How anything works                                                    | The code                                              |

Code cites a doc by file and heading (`DATA.md, Serialisation`), never by section
number, and only for a contract or a reason that lives there.

## Working here

- `npm run verify` passes before every commit.
- `src/library/exercises.csv` and `muscles.csv` are curated by hand: propose
  changes to them rather than making them.
- The GitHub token is never logged, echoed or committed.
- `npm run smoke` needs a token only the maintainer has: ask them to run it.
