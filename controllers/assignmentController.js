const { QueryTypes } = require("sequelize");
const { sequelize, SurveyorAssignment, User, Zone, Ward, Locality } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { resolveScope, scopeClause } = require("../services/surveyorScope");

const LEVEL_KEY = { ZONE: "zone_id", WARD: "ward_id", LOCALITY: "locality_id" };

// Human label for one assignment row, for the admin list and the app. The
// project leads, since that is what is allocated first.
const areaLabel = (a) =>
    a.level === "ZONE"
        ? `Zone: ${a.zone_name || a.zone_id}`
        : a.level === "WARD"
            ? `Ward: ${a.ward_name || a.ward_id}${a.ward_number ? ` (${a.ward_number})` : ""}`
            : `Locality: ${a.locality_name || a.locality_id}`;

const labelFor = (a) => {
    const parts = [];
    if (a.project_name) parts.push(a.project_name);
    parts.push(areaLabel(a));
    parts.push(a.layer_name || "All asset types");
    return parts.join(" › ");
};

// Enriched rows for a user (or everyone), with the parent names filled in.
async function listRows(where = "", repl = {}) {
    return sequelize.query(
        `SELECT a.*, u.full_name, u.phone, u.role,
                p.name AS project_name, p.code AS project_code,
                al.name AS layer_name, al.code AS layer_code, al.geometry_type,
                z.name AS zone_name,
                w.ward_name, w.ward_number,
                l.name AS locality_name,
                (l.boundary IS NOT NULL) AS locality_has_boundary
         FROM "SurveyorAssignments" a
         JOIN "Users" u           ON a.user_id = u.id
         LEFT JOIN "Projects" p     ON a.project_id = p.id
         LEFT JOIN "AssetLayers" al ON a.layer_id = al.id
         LEFT JOIN "Zones" z      ON a.zone_id = z.id
         LEFT JOIN "Wards" w      ON a.ward_id = w.id
         LEFT JOIN "Localities" l ON a.locality_id = l.id
         ${where}
         ORDER BY u.full_name, p.name, a.level`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
}

// GET /api/assignments?user_id=
const listAssignments = asyncHandler(async (req, res) => {
    const { user_id } = req.query;
    const rows = await listRows(
        user_id ? "WHERE a.user_id = :uid AND a.is_active = true" : "WHERE a.is_active = true",
        user_id ? { uid: user_id } : {}
    );
    res.status(200).json({
        success: true,
        count: rows.length,
        data: rows.map((r) => ({ ...r, label: labelFor(r) })),
    });
});

// POST /api/assignments   { user_id, level, zone_id|ward_id|locality_id, project_id?, notes? }
const createAssignment = asyncHandler(async (req, res) => {
    const { user_id, level, project_id = null, layer_id = null, notes = null } = req.body;
    const key = LEVEL_KEY[String(level || "").toUpperCase()];
    if (!user_id || !key) {
        return res.status(400).json({
            success: false,
            message: "user_id and a valid level (ZONE | WARD | LOCALITY) are required.",
        });
    }
    // A surveyor is allocated a project first, then an area inside it. Without
    // the project the grant would span every project sharing that ward.
    if (!project_id) {
        return res.status(400).json({
            success: false,
            message: "project_id is required — allocate a project, then an area within it.",
        });
    }
    const areaId = req.body[key];
    if (!areaId) {
        return res.status(400).json({ success: false, message: `${key} is required for level ${level}.` });
    }

    const user = await User.findByPk(user_id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const Model = { zone_id: Zone, ward_id: Ward, locality_id: Locality }[key];
    const area = await Model.findByPk(areaId);
    if (!area) return res.status(404).json({ success: false, message: `${key} ${areaId} not found.` });

    // Re-assigning the same area is a no-op, not a duplicate row. Sharing an
    // area BETWEEN surveyors is allowed and intentional — only the same
    // (user, area) pair is deduplicated.
    const existing = await SurveyorAssignment.findOne({
        where: { user_id, level: level.toUpperCase(), [key]: areaId, project_id, layer_id },
    });
    if (existing) {
        if (!existing.is_active) await existing.update({ is_active: true });
        return res.status(200).json({
            success: true,
            message: "Already assigned.",
            data: existing,
        });
    }

    const row = await SurveyorAssignment.create({
        user_id,
        level: level.toUpperCase(),
        [key]: areaId,
        project_id,
        layer_id, // null = every asset type in the project
        notes,
        assigned_by: req.user?.id || null,
    });

    res.status(201).json({ success: true, message: "Area assigned.", data: row });
});

// DELETE /api/assignments/:id
const deleteAssignment = asyncHandler(async (req, res) => {
    const row = await SurveyorAssignment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Assignment not found." });
    await row.destroy();
    res.status(200).json({ success: true, message: "Assignment removed." });
});

// GET /api/assignments/me  — what the logged-in surveyor is allocated,
// with their progress in each area. Drives the app's "My allocation" screen.
const myAssignments = asyncHandler(async (req, res) => {
    const scope = await resolveScope(sequelize, req.user);
    const rows = await listRows("WHERE a.user_id = :uid AND a.is_active = true", { uid: req.user.id });

    const totals = await areaProgress(scope);

    // The app navigates project → area → asset type, so hand it that shape
    // rather than a flat list it would have to regroup itself. Progress is
    // computed per project from that project's own grants.
    const byProject = new Map();
    for (const r of rows) {
        const pid = r.project_id || 0;
        if (!byProject.has(pid)) {
            byProject.set(pid, {
                project_id: r.project_id,
                project_name: r.project_name || "Unassigned project",
                project_code: r.project_code || null,
                areas: [],
                layers: new Map(),
            });
        }
        const p = byProject.get(pid);
        p.areas.push({
            id: r.id,
            level: r.level,
            label: areaLabel(r),
            ward_id: r.ward_id,
            zone_id: r.zone_id,
            locality_id: r.locality_id,
            locality_has_boundary: r.locality_has_boundary,
            layer_id: r.layer_id,
            layer_name: r.layer_name,
        });
        // layer_id null = every asset type; represented by the ALL sentinel.
        const key = r.layer_id || "ALL";
        if (!p.layers.has(key)) {
            p.layers.set(key, {
                layer_id: r.layer_id || null,
                name: r.layer_name || "All asset types",
                code: r.layer_code || null,
                geometry_type: r.geometry_type || null,
            });
        }
    }

    const projects = [];
    for (const p of byProject.values()) {
        const pScope = {
            ...scope,
            grants: scope.grants.filter((g) => String(g.projectId || 0) === String(p.project_id || 0)),
        };
        pScope.hasAssignment = pScope.grants.length > 0;
        projects.push({
            project_id: p.project_id,
            project_name: p.project_name,
            project_code: p.project_code,
            areas: p.areas,
            layers: [...p.layers.values()],
            progress: await areaProgress(pScope),
        });
    }

    res.status(200).json({
        success: true,
        data: {
            unrestricted: scope.unrestricted,
            has_assignment: scope.hasAssignment,
            projects,
            // Flat list retained for older app builds.
            areas: rows.map((r) => ({ ...r, label: labelFor(r) })),
            ward_ids: scope.wardIds,
            layer_ids: scope.layerIds,
            any_layer_grant: scope.anyLayerGrant,
            progress: totals,
        },
    });
});

// Survey progress inside a scope: how much is done vs outstanding.
// Uses the same (project, area) clause as the data endpoints, so the number a
// surveyor is measured against is exactly what they can actually see.
async function areaProgress(scope) {
    if (!scope.unrestricted && !scope.hasAssignment) {
        return { total: 0, surveyed: 0, in_progress: 0, pending: 0, percent: 0 };
    }
    const repl = {};
    const scoped = scopeClause(scope, "f", repl);
    const where =
        "f.is_active = true AND f.status = 'PUBLISHED'" + (scoped ? ` AND ${scoped.clause}` : "");

    const rows = await sequelize.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AssetSurveys" s WHERE s.feature_id = f.id)
                               OR EXISTS (SELECT 1 FROM "Properties" pr
                                          JOIN "Surveys" sv ON sv.property_id = pr.id
                                          WHERE f.polygon_id IS NOT NULL AND pr.polygon_id = f.polygon_id
                                            AND sv.status IN ('completed','reviewed')))::int AS surveyed,
           COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "AssetSurveys" s WHERE s.feature_id = f.id)
                              AND EXISTS (SELECT 1 FROM "Properties" pr
                                          JOIN "Surveys" sv ON sv.property_id = pr.id
                                          WHERE f.polygon_id IS NOT NULL AND pr.polygon_id = f.polygon_id
                                            AND sv.status NOT IN ('completed','reviewed')))::int AS in_progress
         FROM "AssetFeatures" f WHERE ${where}`,
        { replacements: repl, type: QueryTypes.SELECT }
    );
    const r = rows[0] || { total: 0, surveyed: 0, in_progress: 0 };
    const pending = Math.max(0, r.total - r.surveyed - r.in_progress);
    return {
        ...r,
        pending,
        percent: r.total ? Math.round((r.surveyed / r.total) * 1000) / 10 : 0,
    };
}

// GET /api/assignments/performance — one row per surveyor, for the admin.
const performance = asyncHandler(async (req, res) => {
    const surveyors = await User.findAll({
        where: { role: "SURVEYOR" },
        attributes: ["id", "full_name", "phone", "is_active"],
        order: [["full_name", "ASC"]],
    });

    const data = [];
    for (const u of surveyors) {
        const scope = await resolveScope(sequelize, { id: u.id, role: "SURVEYOR" });
        const rows = await listRows("WHERE a.user_id = :uid AND a.is_active = true", { uid: u.id });
        const progress = await areaProgress(scope);

        // What this surveyor personally recorded (vs what their area needs).
        const own = await sequelize.query(
            `SELECT
               (SELECT COUNT(*)::int FROM "AssetSurveys" WHERE surveyor_id = :uid) AS asset_surveys,
               (SELECT COUNT(*)::int FROM "Surveys" WHERE surveyor_id = :uid) AS property_surveys,
               (SELECT COUNT(*)::int FROM "Surveys"
                 WHERE surveyor_id = :uid AND status IN ('completed','reviewed')) AS completed,
               (SELECT MAX("createdAt") FROM "Surveys" WHERE surveyor_id = :uid) AS last_survey_at`,
            { replacements: { uid: u.id }, type: QueryTypes.SELECT }
        );

        data.push({
            user: u.toJSON(),
            areas: rows.map((r) => ({ ...r, label: labelFor(r) })),
            area_count: rows.length,
            ward_ids: scope.wardIds,
            progress,
            own: own[0],
        });
    }

    res.status(200).json({ success: true, count: data.length, data });
});

module.exports = {
    listAssignments,
    createAssignment,
    deleteAssignment,
    myAssignments,
    performance,
};
