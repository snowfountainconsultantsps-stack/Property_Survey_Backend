const { QueryTypes } = require("sequelize");
const { sequelize, Project, AssetUpload, AssetFeature } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { loadStats } = require("./assetPdfController");

// ─── Create Project (admin) ──────────────────────────────────
// POST /api/projects
const createProject = asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Project name is required." });
    }

    const project = await Project.create({
        name: name.trim(),
        code: req.body.code || null,
        description: req.body.description || null,
        client_name: req.body.client_name || null,
        department: req.body.department || null,
        state_id: req.body.state_id || null,
        district_id: req.body.district_id || null,
        city_id: req.body.city_id || null,
        ulb_id: req.body.ulb_id || null,
        ward_id: req.body.ward_id || null,
        status: req.body.status || "ACTIVE",
        start_date: req.body.start_date || null,
        end_date: req.body.end_date || null,
        created_by: req.user?.id || null,
    });

    // Auto-fill a code when the admin didn't supply one.
    if (!project.code) {
        project.code = `PRJ-${String(project.id).padStart(4, "0")}`;
        await project.save();
    }

    res.status(201).json({ success: true, message: "Project created.", data: project });
});

// ─── List Projects ───────────────────────────────────────────
// GET /api/projects?status=&mine=
const getProjects = asyncHandler(async (req, res) => {
    const where = { is_active: true };
    if (req.query.status) where.status = req.query.status;

    const projects = await Project.findAll({ where, order: [["createdAt", "DESC"]] });

    // Attach a lightweight asset-feature count per project (single grouped query).
    const counts = await sequelize.query(
        `SELECT project_id, COUNT(*) AS feature_count
         FROM "AssetFeatures"
         WHERE is_active = true AND project_id IS NOT NULL
         GROUP BY project_id`,
        { type: QueryTypes.SELECT }
    );
    const countMap = Object.fromEntries(counts.map((c) => [c.project_id, Number(c.feature_count)]));

    const data = projects.map((p) => ({
        ...p.toJSON(),
        asset_feature_count: countMap[p.id] || 0,
    }));

    res.status(200).json({ success: true, count: data.length, data });
});

// ─── Get Project By Id ───────────────────────────────────────
// GET /api/projects/:id
const getProjectById = asyncHandler(async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });
    res.status(200).json({ success: true, data: project });
});

// ─── Project summary (asset inventory scoped to the project) ──
// GET /api/projects/:id/summary
const getProjectSummary = asyncHandler(async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });

    const [stats, uploads] = await Promise.all([
        loadStats(null, project.id),
        AssetUpload.count({ where: { project_id: project.id } }),
    ]);

    const totals = stats.reduce(
        (acc, s) => {
            acc.features += Number(s.feature_count || 0);
            acc.length_m += Number(s.total_length_m || 0);
            acc.published += Number(s.published || 0);
            acc.flagged += Number(s.flagged || 0);
            return acc;
        },
        { features: 0, length_m: 0, published: 0, flagged: 0 }
    );

    res.status(200).json({
        success: true,
        data: { project, uploads, totals, by_layer: stats },
    });
});

// ─── Update Project (admin) ──────────────────────────────────
// PUT /api/projects/:id
const updateProject = asyncHandler(async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });
    const { name, code, description, client_name, department, city_id, ward_id, status, start_date, end_date } = req.body;
    const patch = {};
    for (const [k, v] of Object.entries({ name, code, description, client_name, department, city_id, ward_id, status, start_date, end_date })) {
        if (v !== undefined) patch[k] = v;
    }
    const updated = await project.update(patch);
    res.status(200).json({ success: true, message: "Project updated.", data: updated });
});

// ─── Archive Project (admin) ─────────────────────────────────
// DELETE /api/projects/:id  → soft archive (data stays linked)
const deleteProject = asyncHandler(async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });
    await project.update({ is_active: false, status: "ARCHIVED" });
    res.status(200).json({ success: true, message: "Project archived." });
});

module.exports = {
    createProject,
    getProjects,
    getProjectById,
    getProjectSummary,
    updateProject,
    deleteProject,
};
