import test from 'node:test';
import assert from 'node:assert/strict';

const API = 'https://localbleachersar-sports-api.james-methvin74.workers.dev';

function levelOfSchool(school) {
  return school.level === 'college' ? 'college' : 'high-school';
}

function summarizeLevel(report, level) {
  const schools = report.schools.filter(s => levelOfSchool(s) === level);
  const schoolIds = new Set(schools.map(s => s.school_id));
  const teams = report.teams.filter(t => schoolIds.has(t.school_id));
  const schoolCounts = {};
  const teamCounts = {};
  for (const key of ['logo_status','conference_status','schedule_status','results_status','records_status','standings_status']) {
    if (key === 'logo_status') {
      schoolCounts[key] = Object.fromEntries(['Complete','Partial','Missing','Unverified'].map(status => [status, schools.filter(s => s[key] === status).length]));
      continue;
    }
    schoolCounts[key] = Object.fromEntries(['Complete','Partial','Missing','Unverified'].map(status => [status, schools.filter(s => s[key] === status).length]));
    teamCounts[key] = Object.fromEntries(['Complete','Partial','Missing','Unverified'].map(status => [status, teams.filter(t => t[key] === status).length]));
  }
  return { schools: schools.length, teams: teams.length, schoolCounts, teamCounts };
}

function pickDeficiencies(report) {
  const schoolsById = new Map(report.schools.map(s => [s.school_id, s]));
  const missingLogos = report.schools
    .filter(s => s.logo_status !== 'Complete')
    .map(s => ({ school_id:s.school_id, name:s.school_name, level:s.level, logo_status:s.logo_status }));
  const teamDeficiencies = report.teams
    .filter(t => ['conference_status','schedule_status','results_status','records_status','standings_status'].some(key => t[key] !== 'Complete'))
    .map(t => {
      const school = schoolsById.get(t.school_id);
      return {
        school_id:t.school_id,
        school_name:school?.school_name || t.school_id,
        level:school?.level || null,
        team_id:t.team_id,
        sport:t.sport,
        gender:t.gender,
        conference:t.conference_status,
        schedule:t.schedule_status,
        results:t.results_status,
        records:t.records_status,
        standings:t.standings_status,
        source_count:t.source_count,
        game_count:t.game_count,
        result_due_count:t.result_due_count,
        resolved_result_count:t.resolved_result_count
      };
    });
  return { missingLogos, teamDeficiencies };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent':'LocalBleachersAR-completeness-audit/1.0' } });
  assert.equal(response.status, 200, `${url} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

test('capture one bounded statewide production completeness snapshot', async () => {
  // Exactly one production D1-backed call. /coverage-report itself uses one set-based aggregate query.
  const report = await fetchJson(`${API}/api/v1/coverage-report`);
  assert.ok(Array.isArray(report.schools));
  assert.ok(Array.isArray(report.teams));

  // Standings option discovery is provider-backed, not D1-backed.
  const [footballOptions, volleyballOptions] = await Promise.all([
    fetchJson(`${API}/api/v1/standings/options?sport=football`),
    fetchJson(`${API}/api/v1/standings/options?sport=volleyball`)
  ]);

  const output = {
    generated_at: report.generated_at,
    production_summary: report.summary,
    denominators: {
      expected_high_schools: 295,
      expected_high_school_supported_teams: 1102,
      expected_colleges: 36,
      expected_college_supported_teams: 130,
      expected_college_active_ready_teams: 103,
      expected_college_inactive_unpublished_or_blocked: 27
    },
    high_school: summarizeLevel(report, 'high-school'),
    college: summarizeLevel(report, 'college'),
    standings_surface: {
      supported_sports_in_code: ['football','volleyball'],
      football_conferences_discovered: footballOptions.conferences?.length || 0,
      volleyball_conferences_discovered: volleyballOptions.conferences?.length || 0,
      basketball_supported: false,
      soccer_supported: false,
      college_standings_supported: false
    },
    deficiencies: pickDeficiencies(report)
  };

  console.log('STATEWIDE_COMPLETENESS_AUDIT_BEGIN');
  console.log(JSON.stringify(output));
  console.log('STATEWIDE_COMPLETENESS_AUDIT_END');
});
