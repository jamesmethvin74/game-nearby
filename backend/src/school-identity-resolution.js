import { normalizeSchoolAlias } from "./schedule-authority-core.js";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function externalKey(provider, externalSchoolId) {
  const providerKey = clean(provider).toLowerCase();
  const externalKeyValue = clean(externalSchoolId).toUpperCase();
  return providerKey && externalKeyValue ? `${providerKey}:${externalKeyValue}` : "";
}

function addCandidate(map, key, schoolId) {
  const normalizedKey = clean(key);
  const id = clean(schoolId);
  if (!normalizedKey || !id) return;
  if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
  map.get(normalizedKey).add(id);
}

function candidateResolution(candidates, method, normalizedAlias = "") {
  const ids = [...(candidates || [])].sort();
  if (ids.length === 1) {
    return { status:"resolved", schoolId:ids[0], method, normalizedAlias, candidateSchoolIds:ids };
  }
  if (ids.length > 1) {
    return { status:"ambiguous", schoolId:null, method, normalizedAlias, candidateSchoolIds:ids };
  }
  return null;
}

function persistenceConflict(result, existingSchoolId, method) {
  const ids = [...new Set([result.schoolId, clean(existingSchoolId)].filter(Boolean))].sort();
  return {
    status:"ambiguous",
    schoolId:null,
    method,
    normalizedAlias:result.normalizedAlias,
    candidateSchoolIds:ids
  };
}

export function buildSchoolIdentityIndex({ schools = [], aliases = [], externalIdentities = [] } = {}) {
  const canonicalCandidates = new Map();
  const aliasCandidates = new Map();
  const externalCandidates = new Map();

  for (const school of schools) {
    const schoolId = clean(school.id || school.school_id);
    const names = [school.name, ...(Array.isArray(school.alternate_names) ? school.alternate_names : [])]
      .map(clean)
      .filter(Boolean);
    const mascot = clean(school.mascot);
    for (const name of new Set(names)) {
      addCandidate(canonicalCandidates, normalizeSchoolAlias(name), schoolId);
      if (mascot) addCandidate(canonicalCandidates, normalizeSchoolAlias(`${name} ${mascot}`), schoolId);
    }
  }

  for (const alias of aliases) {
    const normalized = clean(alias.normalized_alias) || normalizeSchoolAlias(alias.alias_text);
    addCandidate(aliasCandidates, normalized, alias.school_id);
  }

  for (const identity of externalIdentities) {
    addCandidate(externalCandidates, externalKey(identity.provider, identity.external_school_id), identity.school_id);
  }

  return { canonicalCandidates, aliasCandidates, externalCandidates };
}

export function resolveSchoolIdentity({ observedName = "", provider = "", externalSchoolId = "" } = {}, index) {
  const normalizedAlias = normalizeSchoolAlias(observedName);
  const providerIdentity = externalKey(provider, externalSchoolId);

  if (providerIdentity) {
    const resolved = candidateResolution(index?.externalCandidates?.get(providerIdentity), "external-id", normalizedAlias);
    if (resolved) return resolved;
  }

  if (normalizedAlias) {
    const aliasResolved = candidateResolution(index?.aliasCandidates?.get(normalizedAlias), "alias", normalizedAlias);
    if (aliasResolved) return aliasResolved;

    const canonicalResolved = candidateResolution(index?.canonicalCandidates?.get(normalizedAlias), "canonical-name", normalizedAlias);
    if (canonicalResolved) return canonicalResolved;
  }

  return { status:"unresolved", schoolId:null, method:null, normalizedAlias, candidateSchoolIds:[] };
}

function aliasCanBeRemembered(index, normalizedAlias, schoolId) {
  if (!normalizedAlias || !schoolId) return false;
  const aliasIds = [...(index.aliasCandidates.get(normalizedAlias) || [])];
  if (aliasIds.length && (aliasIds.length !== 1 || aliasIds[0] !== schoolId)) return false;
  const canonicalIds = [...(index.canonicalCandidates.get(normalizedAlias) || [])];
  if (canonicalIds.length > 1) return false;
  if (canonicalIds.length === 1 && canonicalIds[0] !== schoolId) return false;
  return true;
}

export async function createSchoolIdentityResolver(env) {
  const snapshot = await env.DB.prepare(`
    SELECT 'school' AS identity_kind,id AS identity_key,id AS school_id,name AS observed_name,mascot,NULL AS provider,NULL AS external_school_id
    FROM schools
    UNION ALL
    SELECT 'alias',normalized_alias,school_id,alias_text,NULL,NULL,NULL
    FROM school_aliases
    UNION ALL
    SELECT 'external',provider || ':' || external_school_id,school_id,observed_name,NULL,provider,external_school_id
    FROM school_external_identities
  `).all();

  const schools = [];
  const aliases = [];
  const externalIdentities = [];
  for (const row of snapshot?.results || []) {
    if (row.identity_kind === "school") schools.push({ id:row.school_id, name:row.observed_name, mascot:row.mascot });
    else if (row.identity_kind === "alias") aliases.push({ normalized_alias:row.identity_key, school_id:row.school_id, alias_text:row.observed_name });
    else if (row.identity_kind === "external") externalIdentities.push({ provider:row.provider, external_school_id:row.external_school_id, school_id:row.school_id, observed_name:row.observed_name });
  }

  const index = buildSchoolIdentityIndex({ schools, aliases, externalIdentities });

  return {
    index,
    async resolveAndRemember(input = {}) {
      const result = resolveSchoolIdentity(input, index);
      if (result.status !== "resolved") return result;

      const observedName = clean(input.observedName);
      const normalizedAlias = result.normalizedAlias;
      if (observedName && aliasCanBeRemembered(index, normalizedAlias, result.schoolId) && !index.aliasCandidates.has(normalizedAlias)) {
        const inserted = await env.DB.prepare(`
          INSERT INTO school_aliases(normalized_alias,school_id,alias_text)
          VALUES(?,?,?)
          ON CONFLICT(normalized_alias) DO NOTHING
          RETURNING school_id
        `).bind(normalizedAlias, result.schoolId, observedName).first();
        if (inserted?.school_id) {
          addCandidate(index.aliasCandidates, normalizedAlias, inserted.school_id);
        } else {
          const existing = await env.DB.prepare("SELECT school_id FROM school_aliases WHERE normalized_alias=?").bind(normalizedAlias).first();
          if (existing?.school_id && existing.school_id !== result.schoolId) {
            addCandidate(index.aliasCandidates, normalizedAlias, existing.school_id);
            return persistenceConflict(result, existing.school_id, "alias-persistence-conflict");
          }
          if (existing?.school_id) addCandidate(index.aliasCandidates, normalizedAlias, existing.school_id);
        }
      }

      const identityKey = externalKey(input.provider, input.externalSchoolId);
      if (identityKey && !index.externalCandidates.has(identityKey)) {
        const provider = clean(input.provider).toLowerCase();
        const externalSchoolId = clean(input.externalSchoolId).toUpperCase();
        const inserted = await env.DB.prepare(`
          INSERT INTO school_external_identities(provider,external_school_id,school_id,observed_name,last_seen_at,updated_at)
          VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(provider,external_school_id) DO NOTHING
          RETURNING school_id
        `).bind(provider, externalSchoolId, result.schoolId, observedName || externalSchoolId).first();
        if (inserted?.school_id) {
          addCandidate(index.externalCandidates, identityKey, inserted.school_id);
        } else {
          const existing = await env.DB.prepare("SELECT school_id FROM school_external_identities WHERE provider=? AND external_school_id=?")
            .bind(provider, externalSchoolId).first();
          if (existing?.school_id && existing.school_id !== result.schoolId) {
            addCandidate(index.externalCandidates, identityKey, existing.school_id);
            return persistenceConflict(result, existing.school_id, "external-id-persistence-conflict");
          }
          if (existing?.school_id) addCandidate(index.externalCandidates, identityKey, existing.school_id);
        }
      }

      return result;
    }
  };
}
