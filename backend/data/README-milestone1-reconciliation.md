# Milestone 1 production reconciliation

This checkpoint compares the 295 AAA/DragonFly-certified Arkansas high-school organizations in `arkansas-high-school-team-inventory*.json` against the live production `GET /api/v1/coverage-report` school catalog.

Current checkpoint:
- 295 certified AAA high schools
- 195 production rows currently labeled `high-school`
- 184 certified AAA schools matched to production
- 111 certified AAA schools not yet represented/matched in production
- 1,102 expected supported team targets statewide
- 814 team targets attached to matched production schools
- 288 team targets attached to the 111 missing schools
- 11 production high-school rows are not part of the certified AAA 295 and remain explicitly listed for cleanup or identity review

The 288 missing team targets break down as 107 boys basketball, 103 girls basketball, 56 football, 11 boys soccer, 10 girls soccer, and 1 girls volleyball.

This is an inventory/reconciliation artifact only. It does not modify Home, public game queries, collectors, D1 schema/data, records, standings, or frontend behavior.
