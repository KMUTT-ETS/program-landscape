# tcas-sample.xlsx

A slice of the public TCAS67 round-3 max/min file
(`https://assets.mytcas.com/67/TCAS67_maxmin.xlsx`, mytcas.com), original Thai
headers kept. Contains all 65 rows of มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี plus
15 rows each of KMUTNB and KMITL and 10 of Khon Kaen University.

Two synthetic rows were added for tests (course codes ending `Z`):

- `10140107399991Z`: a copy of a real KMUTT row with a new course code (same
  faculty and programme name, a second track).
- `10140107399992Z`: a KMUTT row with a new code and blank `ผ่าน(รอบ1)` /
  `ผ่าน(รอบ2)` cells (programme name marked "ทดสอบ ผ่านว่าง").

# tcas-match-cases.json

Differential cases for `wsmock/tcas_match.py`. Each set holds a match index
(`index`, the shape of `TcasMatchProgramme`) and `cases` of real TCAS rows
(faculty, programme, major) with `expected`, the id returned by the real
TypeScript `findOwnProgrammeMatch` (`packages/shared/src/ingestion/tcas-match.ts`)
or `null`. Produced from the real KKU, KMUTNB and KMUTT rows of all nine TCAS
files: a throwaway Python script picked a few latest-year programmes of three
faculties as the index and listed every row of those faculties; a throwaway
`tsx` script ran `buildTcasMatchIndex`/`findOwnProgrammeMatch` over them; a
balanced sample (matches and misses, with and without a `major`) was kept. The
`kku-major` set targets KKU rows that have a major. The generators are not
committed. The test `DifferentialTests` asserts the Python port gives the same
answer for every case.
