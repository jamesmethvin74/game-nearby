import fs from 'node:fs';

const API = 'https://localbleachersar-sports-api.james-methvin74.workers.dev';

function schoolLevel(school) {
  return school.level === 'college' ? 'college' : 'high-school';
}

function counts(values, key) {
  const statuses = ['Complete','Partial','Missing','Unverified'];
  return Object.fromEntries(statuses.map(status => [status, values.filter(value => value[key] === status).length]));
}

function summarizeLevel(report, level) {
  const schools = report.schools.filter(s => schoolLevel(s) === level);
  const schoolIds = new Set(schools.map(s => s.school_id));
  const teams = report.teams.filter(t => schoolIds.has(t.school_id));
  const schoolCounts = { logo_status: counts(schools, 'logo_status') };
  const teamCounts = {};
  for (const key of ['conference_status','schedule_status','results_status','records_status','standings_status']) {
    schoolCounts[key] = counts(schools, key);
    teamCounts[key] = counts(teams, key);
  }
  return { schools: schools.length, teams: teams.length, schoolCounts, teamCounts };
}

function deficiencies(report) {
  const schoolById = new Map(report.schools.map(s => [s.school_id, s]));
  return {
    missingLogos: report.schools
      .filter(s => s.logo_status !== 'Complete')
      .map(s => ({ school_id:s.school_id, school_name:s.school_name, level:s.level })),
    teams: report.teams
      .filter(t => ['conference_status','schedule_status','results_status','records_status','standings_status'].some(key => t[key] !== 'Complete'))
      .map(t => {
        const school = schoolById.get(t.school_id);
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
      })
  };
}

async function fetchResult(url) {
  const response = await fetch(url, { headers: { 'user-agent':'LocalBleachersAR-completeness-audit/1.0' } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw:text.slice(0,1000) }; }
  return { status:response.status, body };
}

const coverage = await fetchResult(`${API}/api/v1/coverage-report`);
if (coverage.status !== 200 || !Array.isArray(coverage.body?.schools) || !Array.isArray(coverage.body?.teams)) {
  throw new Error(`coverage report failed: HTTP ${coverage.status} ${JSON.stringify(coverage.body)}`);
}

const report = coverage.body;
const [football, volleyball] = await Promise.all([
  fetchResult(`${API}/api/v1/standings/options?sport=football`),
  fetchResult(`${API}/api/v1/standings/options?sport=volleyball`)
]);

const output = {
  generated_at: report.generated_at,
  captured_at: new Date().toISOString(),
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
    football_options_http: football.status,
    football_conferences_discovered: Array.isArray(football.body?.conferences) ? football.body.conferences.length : 0,
    volleyball_options_http: volleyball.status,
    volleyball_conferences_discovered: Array.isArray(volleyball.body?.conferences) ? volleyball.body.conferences.length : 0,
    basketball_supported: false,
    soccer_supported: false,
    college_standings_supported: false
  },
  deficiencies: deficiencies(report)
};

fs.writeFileSync('statewide-completeness-audit.json', JSON.stringify(output, null, 2));
console.log('WROTE statewide-completeness-audit.json');
