/**
 * surveyorScope.js
 *
 * Resolves a user's SurveyorAssignment rows into a concrete filter over
 * AssetFeatures, so a surveyor only ever sees the area they were allocated.
 *
 * A surveyor is allocated a PROJECT first, then an area inside it, so every
 * assignment is a (project, area) PAIR. The pairing matters: someone granted
 * (Project A, Ward 1) and (Project B, Ward 2) must NOT thereby reach
 * (Project A, Ward 2). Each grant is therefore compiled to its own
 * `project AND area` condition and the grants are OR-ed together — never
 * flattened into one project list AND one ward list.
 *
 * Area resolution:
 *   WARD      → that ward.
 *   ZONE      → every ward currently in the zone, looked up at query time so
 *               adding a ward to a zone extends the assignment automatically.
 *   LOCALITY  → the locality's ward for the coarse filter, plus a spatial
 *               restriction to the locality's boundary WHEN it has one.
 *               Localities are non-statutory and boundaries optional (see
 *               models/locality.js), so without a boundary the grant can only
 *               be honoured at ward granularity — reported, not hidden.
 *
 * Roles that manage or review data (ADMIN, SUPERVISOR, GIS_*) are never
 * scoped — `unrestricted: true`.
 */
const { QueryTypes } = require("sequelize");

const UNSCOPED_ROLES = ["ADMIN", "SUPERVISOR", "GIS_ADMIN", "GIS_EDITOR"];

async function resolveScope(sequelize, user) {
    if (!user) return emptyScope();
    if (UNSCOPED_ROLES.includes(user.role)) {
        return { ...emptyScope(), unrestricted: true };
    }

    const rows = await sequelize.query(
        `SELECT a.id, a.level, a.zone_id, a.ward_id, a.locality_id, a.project_id, a.layer_id,
                p.name  AS project_name,
                al.name AS layer_name, al.code AS layer_code, al.geometry_type,
                z.name  AS zone_name,
                w.ward_name, w.ward_number,
                l.name  AS locality_name,
                l.ward_id AS locality_ward_id,
                (l.boundary IS NOT NULL) AS locality_has_boundary
         FROM "SurveyorAssignments" a
         LEFT JOIN "Projects" p     ON a.project_id = p.id
         LEFT JOIN "AssetLayers" al ON a.layer_id = al.id
         LEFT JOIN "Zones" z        ON a.zone_id = z.id
         LEFT JOIN "Wards" w        ON a.ward_id = w.id
         LEFT JOIN "Localities" l   ON a.locality_id = l.id
         WHERE a.user_id = :uid AND a.is_active = true`,
        { replacements: { uid: user.id }, type: QueryTypes.SELECT }
    );

    if (!rows.length) return emptyScope();

    // Wards belonging to each assigned zone, fetched once.
    const zoneIds = [...new Set(rows.filter((r) => r.level === "ZONE" && r.zone_id).map((r) => r.zone_id))];
    const wardsByZone = new Map();
    if (zoneIds.length) {
        const wards = await sequelize.query(
            `SELECT id, zone_id FROM "Wards" WHERE zone_id IN (:zoneIds) AND is_active = true`,
            { replacements: { zoneIds }, type: QueryTypes.SELECT }
        );
        wards.forEach((w) => {
            if (!wardsByZone.has(w.zone_id)) wardsByZone.set(w.zone_id, []);
            wardsByZone.get(w.zone_id).push(w.id);
        });
    }

    const grants = [];
    const allWardIds = new Set();
    const coarseLocalities = [];

    for (const r of rows) {
        const grant = {
            assignmentId: r.id,
            projectId: r.project_id || null,
            // null = every layer in the project.
            layerId: r.layer_id || null,
            wardIds: [],
            localityIds: [],
        };

        if (r.level === "WARD" && r.ward_id) {
            grant.wardIds.push(r.ward_id);
        } else if (r.level === "ZONE" && r.zone_id) {
            grant.wardIds.push(...(wardsByZone.get(r.zone_id) || []));
        } else if (r.level === "LOCALITY" && r.locality_id) {
            if (r.locality_ward_id) grant.wardIds.push(r.locality_ward_id);
            if (r.locality_has_boundary) grant.localityIds.push(r.locality_id);
            else coarseLocalities.push(r.locality_id);
        }

        // A grant with no resolvable area (e.g. an empty zone) must not become
        // a project-wide pass — drop it instead.
        if (!grant.wardIds.length && !grant.localityIds.length) continue;

        grant.wardIds.forEach((w) => allWardIds.add(w));
        grants.push(grant);
    }

    return {
        unrestricted: false,
        hasAssignment: grants.length > 0,
        grants,
        wardIds: [...allWardIds],
        projectIds: [...new Set(grants.map((g) => g.projectId).filter(Boolean))],
        layerIds: [...new Set(grants.map((g) => g.layerId).filter(Boolean))],
        // True when at least one grant covers every layer in its project, so
        // callers know the layer list isn't exhaustive.
        anyLayerGrant: grants.some((g) => !g.layerId),
        coarseLocalities,
        assignments: rows,
    };
}

function emptyScope() {
    return {
        unrestricted: false,
        hasAssignment: false,
        grants: [],
        wardIds: [],
        projectIds: [],
        layerIds: [],
        anyLayerGrant: false,
        coarseLocalities: [],
        assignments: [],
    };
}

/**
 * SQL fragment restricting a table alias to the scope, plus replacements to
 * merge into the query. Returns null when no restriction applies.
 *
 * Fails CLOSED: a scoped user with no assignment gets `FALSE` — no data,
 * never the whole city.
 */
function scopeClause(scope, alias = "f", repl = {}) {
    if (scope.unrestricted) return null;
    if (!scope.hasAssignment) return { clause: "FALSE", replacements: repl };

    const orParts = [];
    scope.grants.forEach((g, i) => {
        const and = [];

        if (g.projectId) {
            and.push(`${alias}.project_id = :sgp${i}`);
            repl[`sgp${i}`] = g.projectId;
        }
        // A layer-specific grant hides every other asset type in that area.
        if (g.layerId) {
            and.push(`${alias}.layer_id = :sgly${i}`);
            repl[`sgly${i}`] = g.layerId;
        }

        const areaOr = [];
        if (g.wardIds.length) {
            areaOr.push(`${alias}.ward_id IN (:sgw${i})`);
            repl[`sgw${i}`] = g.wardIds;
        }
        if (g.localityIds.length) {
            areaOr.push(
                `EXISTS (SELECT 1 FROM "Localities" sl
                          WHERE sl.id IN (:sgl${i})
                            AND sl.boundary IS NOT NULL
                            AND ST_Intersects(sl.boundary, ${alias}.geom))`
            );
            repl[`sgl${i}`] = g.localityIds;
        }
        if (!areaOr.length) return;

        and.push(`(${areaOr.join(" OR ")})`);
        orParts.push(`(${and.join(" AND ")})`);
    });

    if (!orParts.length) return { clause: "FALSE", replacements: repl };
    return { clause: `(${orParts.join(" OR ")})`, replacements: repl };
}

/**
 * True when the user may see/act on one specific feature. Filtering the list
 * endpoints isn't enough on its own — ids are guessable, so the
 * single-feature and survey-submission paths need the same check.
 */
async function isFeatureInScope(sequelize, user, featureId) {
    const scope = await resolveScope(sequelize, user);
    if (scope.unrestricted) return true;
    if (!scope.hasAssignment) return false;

    const repl = { fid: featureId };
    const scoped = scopeClause(scope, "f", repl);
    if (!scoped || scoped.clause === "FALSE") return false;

    const rows = await sequelize.query(
        `SELECT 1 FROM "AssetFeatures" f WHERE f.id = :fid AND ${scoped.clause} LIMIT 1`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
    return rows.length > 0;
}

module.exports = { resolveScope, scopeClause, isFeatureInScope, UNSCOPED_ROLES };
