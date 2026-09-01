from pathlib import Path
import re


def replace_once(path, old, new, label):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    p.write_text(text.replace(old,new,1))


def regex_once(path, pattern, repl, label):
    p=Path(path); text=p.read_text(); out,count=re.subn(pattern,repl,text,count=1,flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    p.write_text(out)


replace_once(
    "backend/src/index.js",
    'import { recordFromScheduleRows } from "./schedule-response-normalizer.js";\n',
    'import { rebuildTeamRecord } from "./record-rebuild.js";\n',
    "index record import",
)
regex_once(
    "backend/src/index.js",
    r'async function recalculateRecord\(env,teamId\)\{.*?\n\}\n\n(?=async function recalculateStandingsIfComplete)',
    'async function recalculateRecord(env,teamId){\n  await rebuildTeamRecord(env,teamId);\n}\n\n',
    "index recalculate delegate",
)

path=Path("backend/src/schedule-response-normalizer.js")
text=path.read_text()
old='''  const aTime = a.scheduled_at || a.canonical_scheduled_at;
  const bTime = b.scheduled_at || b.canonical_scheduled_at;
  if (minutesBetween(aTime, bTime) > maxMinutes) return false;
  return opponentNamesLikelySame(a.opponent, b.opponent);
'''
new='''  const aTime = a.scheduled_at || a.canonical_scheduled_at;
  const bTime = b.scheduled_at || b.canonical_scheduled_at;
  if (minutesBetween(aTime, bTime) > maxMinutes) return false;
  const aOpponentId = clean(a.opponent_school_id);
  const bOpponentId = clean(b.opponent_school_id);
  if (aOpponentId && bOpponentId) return aOpponentId === bOpponentId;
  return opponentNamesLikelySame(a.opponent, b.opponent);
'''
count=text.count(old)
if count != 1:
    raise SystemExit(f"opponent identity dedupe: expected one match, found {count}")
path.write_text(text.replace(old,new,1))
