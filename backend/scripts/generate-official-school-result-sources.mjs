#!/usr/bin/env node
import {
  OFFICIAL_SCHOOL_SOURCE_CATALOG,
  buildOfficialSchoolResultSourceMigrationSql
} from "../src/official-school-source-catalog.js";

process.stdout.write(buildOfficialSchoolResultSourceMigrationSql(
  OFFICIAL_SCHOOL_SOURCE_CATALOG,
  {season:process.env.SEASON||"2026",batchLabel:process.env.BATCH_LABEL||"batch 3"}
));
