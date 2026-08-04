const { AssetCategory, AssetLayer } = require("../models");

/**
 * Idempotent seed for the digital-asset catalog (categories + layers).
 * Runs at startup after model sync. Uses findOrCreate keyed on the unique
 * `code`, so re-running never duplicates and never overwrites admin edits to
 * an existing layer's style/schema.
 */

// Reusable attribute-schema fragments.
const CONDITION = {
    key: "condition",
    label: "Condition",
    type: "select",
    options: ["Good", "Fair", "Poor", "Damaged"],
    required: false,
};

const CATALOG = [
    {
        code: "DRAIN_SEWER",
        name: "Drainage & Sewer",
        description: "Storm drains, sewer lines and manholes.",
        color: "#78716c",
        icon: "waves",
        sort_order: 1,
        layers: [
            {
                code: "SEWER_LINE",
                name: "Sewer Line",
                geometry_type: "LINESTRING",
                style: { color: "#78350f", weight: 3 },
                attribute_schema: [
                    { key: "diameter_mm", label: "Diameter (mm)", type: "number", unit: "mm" },
                    { key: "material", label: "Material", type: "select", options: ["RCC", "PVC", "Stoneware", "HDPE"] },
                    { key: "depth_m", label: "Depth (m)", type: "number", unit: "m" },
                    CONDITION,
                ],
            },
            {
                code: "STORM_DRAIN",
                name: "Storm Drain",
                geometry_type: "LINESTRING",
                style: { color: "#0891b2", weight: 3 },
                attribute_schema: [
                    { key: "width_m", label: "Width (m)", type: "number", unit: "m" },
                    { key: "drain_type", label: "Type", type: "select", options: ["Open", "Covered", "Piped"] },
                    { key: "lined", label: "Lined", type: "boolean" },
                    CONDITION,
                ],
            },
            {
                code: "MANHOLE",
                name: "Manhole",
                geometry_type: "POINT",
                style: { color: "#44403c", radius: 6, fillColor: "#44403c", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "depth_m", label: "Depth (m)", type: "number", unit: "m" },
                    { key: "cover_type", label: "Cover Type", type: "select", options: ["RCC", "Cast Iron", "FRP", "Missing"] },
                    CONDITION,
                ],
            },
        ],
    },
    {
        code: "WATER_SUPPLY",
        name: "Water Supply",
        description: "Distribution pipelines, valves, hydrants and tanks.",
        color: "#0ea5e9",
        icon: "droplet",
        sort_order: 2,
        layers: [
            {
                code: "WATER_PIPELINE",
                name: "Water Pipeline",
                geometry_type: "LINESTRING",
                style: { color: "#0284c7", weight: 3 },
                attribute_schema: [
                    { key: "diameter_mm", label: "Diameter (mm)", type: "number", unit: "mm" },
                    { key: "material", label: "Material", type: "select", options: ["DI", "CI", "PVC", "HDPE", "GI"] },
                    { key: "pressure_class", label: "Pressure Class", type: "text" },
                    CONDITION,
                ],
            },
            {
                code: "WATER_VALVE",
                name: "Valve",
                geometry_type: "POINT",
                style: { color: "#0369a1", radius: 5, fillColor: "#0369a1", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "valve_type", label: "Valve Type", type: "select", options: ["Sluice", "Air", "Scour", "Butterfly"] },
                    { key: "diameter_mm", label: "Diameter (mm)", type: "number", unit: "mm" },
                    CONDITION,
                ],
            },
            {
                code: "FIRE_HYDRANT",
                name: "Fire Hydrant",
                geometry_type: "POINT",
                style: { color: "#dc2626", radius: 5, fillColor: "#dc2626", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "hydrant_type", label: "Type", type: "select", options: ["Pillar", "Underground"] },
                    { key: "working", label: "Working", type: "boolean" },
                    CONDITION,
                ],
            },
            {
                code: "OVERHEAD_TANK",
                name: "Overhead Tank",
                geometry_type: "POLYGON",
                style: { color: "#075985", weight: 2, fillColor: "#0ea5e9", fillOpacity: 0.35 },
                attribute_schema: [
                    { key: "capacity_l", label: "Capacity (L)", type: "number", unit: "L" },
                    { key: "height_m", label: "Staging Height (m)", type: "number", unit: "m" },
                    CONDITION,
                ],
            },
        ],
    },
    {
        code: "ROADS_TRANSPORT",
        name: "Roads & Transport",
        description: "Road network, street lighting and culverts.",
        color: "#f59e0b",
        icon: "road",
        sort_order: 3,
        layers: [
            {
                code: "ROAD_CENTERLINE",
                name: "Road Centerline",
                geometry_type: "LINESTRING",
                style: { color: "#b45309", weight: 4 },
                attribute_schema: [
                    { key: "road_name", label: "Road Name", type: "text" },
                    { key: "surface", label: "Surface", type: "select", options: ["Bituminous", "Concrete", "WBM", "Kutcha"] },
                    { key: "width_m", label: "Width (m)", type: "number", unit: "m" },
                    { key: "lanes", label: "Lanes", type: "number" },
                    CONDITION,
                ],
            },
            {
                code: "STREETLIGHT",
                name: "Streetlight",
                geometry_type: "POINT",
                style: { color: "#f59e0b", radius: 5, fillColor: "#fbbf24", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "pole_type", label: "Pole Type", type: "select", options: ["MS", "Concrete", "Octagonal"] },
                    { key: "lamp_type", label: "Lamp Type", type: "select", options: ["LED", "Sodium", "CFL", "Tube"] },
                    { key: "working", label: "Working", type: "boolean" },
                ],
            },
            {
                code: "CULVERT",
                name: "Culvert",
                geometry_type: "POINT",
                style: { color: "#92400e", radius: 5, fillColor: "#92400e", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "span_m", label: "Span (m)", type: "number", unit: "m" },
                    { key: "culvert_type", label: "Type", type: "select", options: ["Slab", "Box", "Pipe", "Arch"] },
                    CONDITION,
                ],
            },
        ],
    },
    {
        code: "ELECTRICAL",
        name: "Electrical",
        description: "Poles, transformers and LT/HT distribution lines.",
        color: "#ef4444",
        icon: "zap",
        sort_order: 4,
        layers: [
            {
                code: "ELECTRIC_POLE",
                name: "Electric Pole",
                geometry_type: "POINT",
                style: { color: "#b91c1c", radius: 5, fillColor: "#ef4444", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "pole_type", label: "Pole Type", type: "select", options: ["PCC", "Rail", "Tubular", "Wooden"] },
                    { key: "height_m", label: "Height (m)", type: "number", unit: "m" },
                    CONDITION,
                ],
            },
            {
                code: "TRANSFORMER",
                name: "Transformer",
                geometry_type: "POINT",
                style: { color: "#7f1d1d", radius: 6, fillColor: "#991b1b", fillOpacity: 0.9 },
                attribute_schema: [
                    { key: "capacity_kva", label: "Capacity (kVA)", type: "number", unit: "kVA" },
                    { key: "mounting", label: "Mounting", type: "select", options: ["Pole", "Plinth", "Substation"] },
                    CONDITION,
                ],
            },
            {
                code: "LT_LINE",
                name: "LT Line",
                geometry_type: "LINESTRING",
                style: { color: "#f97316", weight: 2 },
                attribute_schema: [
                    { key: "conductor", label: "Conductor", type: "select", options: ["ACSR", "AAAC", "Covered"] },
                    { key: "phase", label: "Phase", type: "select", options: ["1-Phase", "3-Phase"] },
                    CONDITION,
                ],
            },
            {
                code: "HT_LINE",
                name: "HT Line",
                geometry_type: "LINESTRING",
                style: { color: "#dc2626", weight: 2, dashArray: "4" },
                attribute_schema: [
                    { key: "voltage_kv", label: "Voltage (kV)", type: "number", unit: "kV" },
                    { key: "conductor", label: "Conductor", type: "select", options: ["ACSR", "AAAC"] },
                    CONDITION,
                ],
            },
        ],
    },
];

async function seedAssetCatalog() {
    try {
        let createdCats = 0;
        let createdLayers = 0;

        for (const cat of CATALOG) {
            const [category, catCreated] = await AssetCategory.findOrCreate({
                where: { code: cat.code },
                defaults: {
                    name: cat.name,
                    description: cat.description,
                    color: cat.color,
                    icon: cat.icon,
                    sort_order: cat.sort_order,
                },
            });
            if (catCreated) createdCats++;

            let order = 0;
            for (const layer of cat.layers) {
                order += 1;
                const [, layerCreated] = await AssetLayer.findOrCreate({
                    where: { code: layer.code },
                    defaults: {
                        category_id: category.id,
                        name: layer.name,
                        geometry_type: layer.geometry_type,
                        style: layer.style,
                        attribute_schema: layer.attribute_schema,
                        sort_order: order,
                    },
                });
                if (layerCreated) createdLayers++;
            }
        }

        if (createdCats || createdLayers) {
            console.log(
                `✓ Asset catalog seeded (${createdCats} categories, ${createdLayers} layers).`
            );
        }
    } catch (error) {
        console.error("Error seeding asset catalog:", error.message);
    }
}

module.exports = seedAssetCatalog;
