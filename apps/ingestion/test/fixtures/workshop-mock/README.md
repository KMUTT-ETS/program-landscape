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

