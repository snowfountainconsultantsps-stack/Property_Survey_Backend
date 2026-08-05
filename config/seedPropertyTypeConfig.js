const { PropertyTypeConfig } = require("../models");

// ════════════════════════════════════════════════════════════════
// Seeds the 7 leaf property-type configurations.
//
// ⚠️  The `attribute_schema` question lists below are DRAFTS modelled on
//     common Indian ULB property-survey formats — they are NOT transcribed
//     from a notified municipal schedule. Review them against your ULB's
//     official survey form and edit freely: they are data, so changing a
//     question never requires a code change or an app release.
//
// Idempotent: existing rows are matched on (property_type, property_subtype)
// and updated, so re-running only refreshes definitions. Set `force` to
// overwrite schemas that an admin may have edited.
// ════════════════════════════════════════════════════════════════

// Fields shared by anything with people living/working in it.
const WATER_SOURCE = {
    key: "water_source", label: "Water Source", type: "select",
    options: ["Municipal", "Borewell", "Both", "Tanker", "Other"],
};
const PARKING_TYPE = {
    key: "parking_type", label: "Parking", type: "select",
    options: ["None", "Open", "Covered", "Garage", "Basement"],
};

const CONFIGS = [
    // ── Residential ───────────────────────────────────────────────
    {
        property_type: "Residential", property_subtype: "SingleStory",
        category_id: 1, subtype_id: 1, sort_order: 1,
        label: "Residential — Single Storey",
        description: "Independent house on one level.",
        structural_template: "SINGLE", is_multi_entry: false, collects_photos: true,
        attribute_schema: [
            { key: "has_boundary_wall", label: "Boundary Wall", type: "boolean" },
            { key: "open_area_sqm", label: "Open / Setback Area", type: "number", unit: "sq.m" },
            { key: "has_lawn_garden", label: "Lawn / Garden", type: "boolean" },
            PARKING_TYPE,
            { key: "parking_area_sqm", label: "Parking Area", type: "number", unit: "sq.m" },
            WATER_SOURCE,
            { key: "is_corner_plot", label: "Corner Plot", type: "boolean" },
        ],
    },
    {
        property_type: "Residential", property_subtype: "MultiStory",
        category_id: 1, subtype_id: 2, sort_order: 2,
        label: "Residential — Multi Storey",
        description: "Apartment/flat building; each unit surveyed separately.",
        // Photos are captured per unit in this flow, not at property level.
        structural_template: "MULTI", is_multi_entry: true, collects_photos: false,
        attribute_schema: [
            { key: "building_name", label: "Building / Apartment Name", type: "text" },
            { key: "has_lift", label: "Lift Available", type: "boolean" },
            { key: "lift_count", label: "Number of Lifts", type: "number" },
            { key: "common_area_sqm", label: "Common Area", type: "number", unit: "sq.m" },
            { key: "has_security", label: "Security / Guard", type: "boolean" },
            { key: "has_dg_backup", label: "DG / Power Backup", type: "boolean" },
            { key: "has_fire_safety", label: "Fire Safety System", type: "boolean" },
            PARKING_TYPE,
            WATER_SOURCE,
        ],
    },

    // ── Non-Residential ───────────────────────────────────────────
    {
        property_type: "NonResidential", property_subtype: "Commercial",
        category_id: 2, subtype_id: 3, sort_order: 3,
        label: "Non-Residential — Commercial",
        description: "Shop, office, showroom, godown.",
        structural_template: "SINGLE", is_multi_entry: false, collects_photos: true,
        attribute_schema: [
            { key: "business_name", label: "Business / Trade Name", type: "text" },
            {
                key: "business_type", label: "Nature of Business", type: "select",
                options: ["Shop", "Office", "Showroom", "Warehouse/Godown", "Restaurant/Hotel",
                    "Clinic/Hospital", "Bank/ATM", "Workshop", "Education", "Other"],
            },
            { key: "shutter_count", label: "Number of Shutters", type: "number" },
            { key: "frontage_m", label: "Road Frontage", type: "number", unit: "m" },
            { key: "has_mezzanine", label: "Mezzanine Floor", type: "boolean" },
            { key: "mezzanine_area_sqm", label: "Mezzanine Area", type: "number", unit: "sq.m" },
            { key: "trade_license_no", label: "Trade Licence No.", type: "text" },
            { key: "has_signage", label: "Hoarding / Signage", type: "boolean" },
            { key: "signage_area_sqm", label: "Signage Area", type: "number", unit: "sq.m" },
        ],
    },
    {
        property_type: "NonResidential", property_subtype: "PetrolPump",
        category_id: 2, subtype_id: 4, sort_order: 4,
        label: "Non-Residential — Petrol / CNG Pump",
        description: "Fuel station; assessed largely on forecourt and canopy, not office area.",
        structural_template: "SINGLE", is_multi_entry: false, collects_photos: true,
        attribute_schema: [
            {
                key: "oil_company", label: "Oil Company", type: "select",
                options: ["IndianOil", "BPCL", "HPCL", "Reliance", "Nayara", "Shell", "Other"],
            },
            {
                key: "dealership_type", label: "Dealership Type", type: "select",
                options: ["COCO", "CODO", "DODO", "Other"],
            },
            { key: "has_petrol", label: "Petrol Dispensed", type: "boolean" },
            { key: "has_diesel", label: "Diesel Dispensed", type: "boolean" },
            { key: "has_cng", label: "CNG Dispensed", type: "boolean" },
            { key: "has_ev_charging", label: "EV Charging Point", type: "boolean" },
            { key: "dispensing_units", label: "Number of Dispensing Units (nozzles)", type: "number", required: true },
            { key: "storage_tank_count", label: "Number of Storage Tanks", type: "number" },
            { key: "storage_capacity_kl", label: "Total Storage Capacity", type: "number", unit: "KL" },
            // The two areas that actually drive a fuel station's rateable value.
            { key: "canopy_area_sqm", label: "Canopy Area", type: "number", unit: "sq.m", required: true },
            { key: "forecourt_area_sqm", label: "Paved Forecourt Area", type: "number", unit: "sq.m", required: true },
            { key: "has_air_water", label: "Air / Water Facility", type: "boolean" },
            { key: "has_service_station", label: "Service / Washing Bay", type: "boolean" },
            { key: "service_bay_area_sqm", label: "Service Bay Area", type: "number", unit: "sq.m" },
            { key: "has_convenience_store", label: "Convenience Store", type: "boolean" },
            { key: "store_area_sqm", label: "Store Area", type: "number", unit: "sq.m" },
            { key: "licence_no", label: "Explosive / PESO Licence No.", type: "text" },
        ],
    },
    {
        property_type: "NonResidential", property_subtype: "CommercialComplex",
        category_id: 2, subtype_id: 5, sort_order: 5,
        label: "Non-Residential — Commercial Complex",
        description: "Multi-unit mall/market; each shop or office surveyed separately.",
        structural_template: "MULTI", is_multi_entry: true, collects_photos: true,
        attribute_schema: [
            { key: "complex_name", label: "Complex / Market Name", type: "text" },
            { key: "total_shops", label: "Total Shops", type: "number" },
            { key: "total_offices", label: "Total Offices", type: "number" },
            { key: "has_lift", label: "Lift Available", type: "boolean" },
            { key: "lift_count", label: "Number of Lifts", type: "number" },
            { key: "has_escalator", label: "Escalator", type: "boolean" },
            { key: "common_area_sqm", label: "Common / Circulation Area", type: "number", unit: "sq.m" },
            { key: "basement_parking_area_sqm", label: "Basement Parking Area", type: "number", unit: "sq.m" },
            { key: "has_fire_safety", label: "Fire Safety System", type: "boolean" },
            { key: "has_dg_backup", label: "DG / Power Backup", type: "boolean" },
            { key: "has_signage", label: "Hoarding / Signage", type: "boolean" },
            { key: "signage_area_sqm", label: "Signage Area", type: "number", unit: "sq.m" },
        ],
    },

    // ── Mixed ─────────────────────────────────────────────────────
    {
        property_type: "Mixed", property_subtype: null,
        category_id: 3, subtype_id: null, sort_order: 6,
        label: "Mixed Use",
        description: "Shops below, residence above — each floor rated by its own use.",
        structural_template: "SINGLE", is_multi_entry: false, collects_photos: true,
        attribute_schema: [
            { key: "business_name", label: "Business / Trade Name", type: "text" },
            {
                key: "business_type", label: "Nature of Business", type: "select",
                options: ["Shop", "Office", "Showroom", "Restaurant/Hotel", "Clinic", "Other"],
            },
            { key: "commercial_floors", label: "Floors in Commercial Use", type: "number" },
            { key: "residential_floors", label: "Floors in Residential Use", type: "number" },
            { key: "commercial_area_sqm", label: "Total Commercial Area", type: "number", unit: "sq.m" },
            { key: "residential_area_sqm", label: "Total Residential Area", type: "number", unit: "sq.m" },
            { key: "separate_entrance", label: "Separate Residential Entrance", type: "boolean" },
            PARKING_TYPE,
            WATER_SOURCE,
        ],
    },

    // ── Vacant ────────────────────────────────────────────────────
    {
        property_type: "Vacant", property_subtype: null,
        category_id: 4, subtype_id: null, sort_order: 7,
        label: "Vacant Land",
        description: "Open plot with no assessable building.",
        structural_template: "FLAT", is_multi_entry: false, collects_photos: true,
        attribute_schema: [
            {
                key: "land_use", label: "Permitted Land Use", type: "select",
                options: ["Residential", "Commercial", "Industrial", "Agricultural", "Institutional", "Unspecified"],
            },
            { key: "is_boundary_walled", label: "Boundary Wall / Fencing", type: "boolean" },
            { key: "has_road_access", label: "Direct Road Access", type: "boolean" },
            { key: "is_corner_plot", label: "Corner Plot", type: "boolean" },
            { key: "is_cultivated", label: "Under Cultivation", type: "boolean" },
            { key: "has_encroachment", label: "Encroachment Observed", type: "boolean" },
            { key: "has_temporary_structure", label: "Temporary Structure on Plot", type: "boolean" },
            { key: "temporary_structure_area_sqm", label: "Temporary Structure Area", type: "number", unit: "sq.m" },
        ],
    },
];

async function seedPropertyTypeConfig({ force = false } = {}) {
    let created = 0;
    let updated = 0;

    for (const cfg of CONFIGS) {
        const existing = await PropertyTypeConfig.findOne({
            where: {
                property_type: cfg.property_type,
                property_subtype: cfg.property_subtype,
            },
        });

        if (!existing) {
            await PropertyTypeConfig.create(cfg);
            created += 1;
            continue;
        }

        // Never clobber an admin-edited schema unless explicitly forced;
        // structural fields are safe to keep in sync.
        const patch = {
            category_id: cfg.category_id,
            subtype_id: cfg.subtype_id,
            label: cfg.label,
            description: cfg.description,
            structural_template: cfg.structural_template,
            is_multi_entry: cfg.is_multi_entry,
            collects_photos: cfg.collects_photos,
            sort_order: cfg.sort_order,
        };
        if (force || !Array.isArray(existing.attribute_schema) || existing.attribute_schema.length === 0) {
            patch.attribute_schema = cfg.attribute_schema;
        }
        await existing.update(patch);
        updated += 1;
    }

    if (created) console.log(`✅ Property type configs seeded (${created} created, ${updated} updated).`);
    return { created, updated };
}

module.exports = seedPropertyTypeConfig;
module.exports.CONFIGS = CONFIGS;
