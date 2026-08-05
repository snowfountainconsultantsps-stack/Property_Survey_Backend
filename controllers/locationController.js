const { sequelize, State, District, City, Zone, Ulb, Ward, Locality, Polygon } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");

// ──────────────────────────────────────────────────────────────
// Location hierarchy CRUD.
//
//   State → District → ULB → [Zone] → Ward → Locality
//
// The ULB is the operational parent (it defines wards and levies the tax);
// City is a parallel, optional geographic label under District. Zone is an
// optional tier used only by large corporations, so wards attach to the ULB
// and merely reference a zone when one exists.
//
// One generic implementation instead of seven near-identical controllers:
// each level differs only in its model, parent key, field names and sort.
// ──────────────────────────────────────────────────────────────
const LEVELS = {
    states: {
        model: () => State,
        label: "State",
        parentKey: null,
        fields: ["name", "code"],
        required: ["name"],
        order: [["name", "ASC"]],
        childOf: null,
    },
    districts: {
        model: () => District,
        label: "District",
        parentKey: "state_id",
        fields: ["name", "code", "state_id"],
        required: ["name", "state_id"],
        order: [["name", "ASC"]],
        childOf: "states",
    },
    // Geographic label only — not on the path to a ward.
    cities: {
        model: () => City,
        label: "City",
        parentKey: "district_id",
        fields: ["name", "code", "district_id"],
        required: ["name", "district_id"],
        order: [["name", "ASC"]],
        childOf: "districts",
    },
    ulbs: {
        model: () => Ulb,
        label: "ULB",
        parentKey: "district_id",
        fields: ["name", "code", "ulb_type", "district_id", "city_id"],
        required: ["name", "district_id"],
        order: [["name", "ASC"]],
        childOf: "districts",
    },
    zones: {
        model: () => Zone,
        label: "Zone",
        parentKey: "ulb_id",
        fields: ["name", "code", "ulb_id"],
        required: ["name", "ulb_id"],
        order: [["name", "ASC"]],
        childOf: "ulbs",
    },
    wards: {
        model: () => Ward,
        // Listed under the ULB. `zone_id` is optional and, when supplied, the
        // ULB is derived from it (see resolveWardParents).
        label: "Ward",
        parentKey: "ulb_id",
        fields: ["ward_name", "ward_number", "ulb_id", "zone_id"],
        required: ["ward_name", "ulb_id"],
        order: [["ward_number", "ASC"]],
        childOf: "ulbs",
    },
    localities: {
        model: () => Locality,
        label: "Locality",
        parentKey: "ward_id",
        fields: ["name", "code", "locality_type", "alt_names", "pincode", "ward_id"],
        required: ["name", "ward_id"],
        order: [["name", "ASC"]],
        childOf: "wards",
    },
};

function levelConfig(level) {
    const cfg = LEVELS[String(level || "").toLowerCase()];
    if (!cfg) {
        const err = new Error(
            `Unknown level "${level}". Expected one of: ${Object.keys(LEVELS).join(", ")}.`
        );
        err.statusCode = 400;
        throw err;
    }
    return cfg;
}

/**
 * A ward may be created either directly under a ULB or under one of that
 * ULB's zones. When a zone is given it wins, and the ULB is derived from it,
 * so the two can never disagree.
 */
async function resolveWardParents(body) {
    if (!body.zone_id) return body;
    const zone = await Zone.findByPk(body.zone_id);
    if (!zone) {
        const err = new Error(`Zone ${body.zone_id} not found.`);
        err.statusCode = 400;
        throw err;
    }
    return { ...body, ulb_id: zone.ulb_id || body.ulb_id || null };
}

function pickFields(cfg, body) {
    const out = {};
    for (const f of cfg.fields) {
        if (body[f] !== undefined) out[f] = body[f] === "" ? null : body[f];
    }
    return out;
}

// GET /api/locations/:level?parent_id=&include_inactive=
const listLocations = asyncHandler(async (req, res) => {
    const cfg = levelConfig(req.params.level);
    const where = {};
    if (!req.query.include_inactive) where.is_active = true;
    if (req.query.parent_id && cfg.parentKey) where[cfg.parentKey] = req.query.parent_id;

    const rows = await cfg.model().findAll({ where, order: cfg.order });
    res.status(200).json({ success: true, data: rows });
});

// POST /api/locations/:level
const createLocation = asyncHandler(async (req, res) => {
    const cfg = levelConfig(req.params.level);
    let body = pickFields(cfg, req.body);

    const missing = cfg.required.filter((f) => !body[f]);
    if (missing.length) {
        return res
            .status(400)
            .json({ success: false, message: `Missing required field(s): ${missing.join(", ")}.` });
    }

    if (cfg.label === "Ward") body = await resolveWardParents(body);

    const row = await cfg.model().create(body);
    res.status(201).json({ success: true, message: `${cfg.label} created.`, data: row });
});

// PUT /api/locations/:level/:id
const updateLocation = asyncHandler(async (req, res) => {
    const cfg = levelConfig(req.params.level);
    const row = await cfg.model().findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: `${cfg.label} not found.` });

    let body = pickFields(cfg, req.body);
    if (req.body.is_active !== undefined) body.is_active = req.body.is_active;
    if (cfg.label === "Ward" && body.zone_id) body = await resolveWardParents(body);

    await row.update(body);
    res.status(200).json({ success: true, message: `${cfg.label} updated.`, data: row });
});

/** Count what sits beneath a row, so deletes can't silently strand children. */
async function countDependents(level, id) {
    switch (level) {
        case "states":
            return { Districts: await District.count({ where: { state_id: id } }) };
        case "districts":
            return {
                Cities: await City.count({ where: { district_id: id } }),
                ULBs: await Ulb.count({ where: { district_id: id } }),
            };
        // City is a label, not a parent — only the optional ULB link points at it.
        case "cities":
            return { ULBs: await Ulb.count({ where: { city_id: id } }) };
        case "ulbs":
            return {
                Zones: await Zone.count({ where: { ulb_id: id } }),
                Wards: await Ward.count({ where: { ulb_id: id } }),
            };
        case "zones":
            return { Wards: await Ward.count({ where: { zone_id: id } }) };
        case "wards":
            return {
                Polygons: await Polygon.count({ where: { ward_id: id } }),
                Localities: await Locality.count({ where: { ward_id: id } }),
            };
        case "localities":
            return {};
        default:
            return {};
    }
}

// DELETE /api/locations/:level/:id       → archive (is_active=false)
// DELETE /api/locations/:level/:id?hard=1 → permanent, only when childless
const deleteLocation = asyncHandler(async (req, res) => {
    const level = String(req.params.level).toLowerCase();
    const cfg = levelConfig(level);
    const row = await cfg.model().findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: `${cfg.label} not found.` });

    const deps = await countDependents(level, row.id);
    const blocking = Object.entries(deps).filter(([, n]) => n > 0);

    if (req.query.hard) {
        if (blocking.length) {
            return res.status(409).json({
                success: false,
                message: `Cannot delete: ${blocking.map(([k, n]) => `${n} ${k}`).join(", ")} still reference this ${cfg.label}.`,
            });
        }
        await row.destroy();
        return res.status(200).json({ success: true, message: `${cfg.label} deleted.` });
    }

    await row.update({ is_active: false });
    res.status(200).json({
        success: true,
        message: `${cfg.label} archived.`,
        data: { dependents: deps },
    });
});

// GET /api/locations/tree — whole hierarchy in one call, for the admin manager
const getLocationTree = asyncHandler(async (req, res) => {
    const [states, districts, cities, ulbs, zones, wards, localities] = await Promise.all([
        State.findAll({ order: [["name", "ASC"]] }),
        District.findAll({ order: [["name", "ASC"]] }),
        City.findAll({ order: [["name", "ASC"]] }),
        Ulb.findAll({ order: [["name", "ASC"]] }),
        Zone.findAll({ order: [["name", "ASC"]] }),
        Ward.findAll({ order: [["ward_number", "ASC"]] }),
        Locality.findAll({ order: [["name", "ASC"]] }),
    ]);
    res.status(200).json({
        success: true,
        data: {
            states: states.map((s) => s.toJSON()),
            districts: districts.map((d) => d.toJSON()),
            cities: cities.map((c) => c.toJSON()),
            ulbs: ulbs.map((u) => u.toJSON()),
            zones: zones.map((z) => z.toJSON()),
            wards: wards.map((w) => w.toJSON()),
            localities: localities.map((l) => l.toJSON()),
        },
    });
});

module.exports = {
    listLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    getLocationTree,
};
