/**
 * pdfService.js
 *
 * Two PDF generators built on pdfkit (pure Node, no headless browser):
 *
 *   writeDesignDoc(doc)              — the system design / logic-mapping document
 *                                      for the digital-asset backend.
 *   writeWardReport(doc, data)       — a per-ward asset inventory report with a
 *                                      self-contained schematic vector map.
 *
 * Each takes an existing PDFDocument so the caller controls the output stream
 * (HTTP response or a file). Neither performs any network I/O.
 */

const BRAND = "#0f766e";
const MUTED = "#6b7280";
const RULE = "#d1d5db";

// ══════════════════════════════════════════════════════════════
// Shared layout helpers
// ══════════════════════════════════════════════════════════════

function heading(doc, text, level = 1) {
    const sizes = { 1: 18, 2: 13, 3: 11 };
    doc.moveDown(level === 1 ? 0.8 : 0.6);
    doc
        .font("Helvetica-Bold")
        .fontSize(sizes[level] || 11)
        .fillColor(level === 1 ? BRAND : "#111827")
        .text(text);
    if (level === 1) {
        const y = doc.y + 2;
        doc.moveTo(doc.page.margins.left, y)
            .lineTo(doc.page.width - doc.page.margins.right, y)
            .strokeColor(RULE)
            .lineWidth(1)
            .stroke();
        doc.moveDown(0.4);
    }
    doc.fillColor("#111827");
}

function para(doc, text) {
    doc.font("Helvetica").fontSize(10).fillColor("#1f2937").text(text, { align: "left" });
    doc.moveDown(0.3);
}

function bullets(doc, items) {
    doc.font("Helvetica").fontSize(10).fillColor("#1f2937");
    items.forEach((it) => doc.text(`•  ${it}`, { indent: 8 }));
    doc.moveDown(0.3);
}

/** Minimal fixed-column table. cols: [{label,width}], rows: string[][]. */
function table(doc, cols, rows) {
    const left = doc.page.margins.left;
    const rowH = 16;
    const drawRow = (cells, isHeader) => {
        // page break
        if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) doc.addPage();
        let x = left;
        const y = doc.y;
        doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
            .fillColor(isHeader ? "#111827" : "#374151");
        cols.forEach((c, i) => {
            doc.text(String(cells[i] ?? ""), x + 3, y + 4, { width: c.width - 6, ellipsis: true, lineBreak: false });
            x += c.width;
        });
        doc.moveTo(left, y + rowH)
            .lineTo(left + cols.reduce((s, c) => s + c.width, 0), y + rowH)
            .strokeColor(RULE).lineWidth(0.5).stroke();
        doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.label), true);
    rows.forEach((r) => drawRow(r, false));
    doc.moveDown(0.5);
}

// ══════════════════════════════════════════════════════════════
// 1) DESIGN DOCUMENT
// ══════════════════════════════════════════════════════════════

const SEED_LAYERS = [
    ["Drainage & Sewer", "Sewer Line", "LINESTRING"],
    ["Drainage & Sewer", "Storm Drain", "LINESTRING"],
    ["Drainage & Sewer", "Manhole", "POINT"],
    ["Water Supply", "Water Pipeline", "LINESTRING"],
    ["Water Supply", "Valve", "POINT"],
    ["Water Supply", "Fire Hydrant", "POINT"],
    ["Water Supply", "Overhead Tank", "POLYGON"],
    ["Roads & Transport", "Road Centerline", "LINESTRING"],
    ["Roads & Transport", "Streetlight", "POINT"],
    ["Roads & Transport", "Culvert", "POINT"],
    ["Electrical", "Electric Pole", "POINT"],
    ["Electrical", "Transformer", "POINT"],
    ["Electrical", "LT Line", "LINESTRING"],
    ["Electrical", "HT Line", "LINESTRING"],
];

const API_MAP = [
    ["POST", "/api/projects", "Create a project (admin)"],
    ["GET", "/api/projects", "List projects (with asset counts)"],
    ["GET", "/api/projects/:id/summary", "Project asset inventory summary"],
    ["GET", "/api/assets/categories", "Catalog: categories + their layers"],
    ["GET/POST", "/api/assets/layers", "List / create asset layers (admin)"],
    ["PUT/DELETE", "/api/assets/layers/:id", "Edit / archive a layer (admin)"],
    ["POST", "/api/assets/layers/:id/uploads", "Upload shapefile-zip or GeoJSON → stage (admin)"],
    ["GET", "/api/assets/uploads", "List import batches"],
    ["GET", "/api/assets/uploads/:id/features", "Staged features as GeoJSON (map review)"],
    ["POST", "/api/assets/uploads/:id/verify", "Mark batch verified (admin)"],
    ["POST", "/api/assets/uploads/:id/publish", "Publish batch → live for surveyors"],
    ["POST", "/api/assets/uploads/:id/reject", "Reject batch"],
    ["GET", "/api/assets/map", "Layered map: all layers + features grouped"],
    ["GET", "/api/assets/layers/:id/features", "One layer's features (GeoJSON, bbox/ward filters)"],
    ["POST", "/api/assets/features", "Manually add a feature (draw on map)"],
    ["PUT/DELETE", "/api/assets/features/:id", "Edit geometry/attrs / soft-delete"],
    ["GET", "/api/assets/features/nearby", "Assets near a surveyor's GPS"],
    ["POST", "/api/assets/features/:id/survey", "Surveyor observation / correction"],
    ["POST", "/api/assets/surveys/:id/approve", "Apply a correction to the feature (admin)"],
    ["POST", "/api/assets/features/:id/photos", "Attach field photos (Cloudinary)"],
    ["GET", "/api/assets/stats", "Per-layer inventory (counts/length/area/status)"],
    ["GET", "/api/assets/reports/ward/:wardId", "Ward asset report PDF"],
    ["GET", "/api/assets/reports/project/:projectId", "Project asset report PDF"],
    ["GET", "/api/assets/docs/design.pdf", "This design document"],
];

function writeDesignDoc(doc) {
    // ── Cover ──
    doc.font("Helvetica-Bold").fontSize(26).fillColor(BRAND)
        .text("Digital Asset System", { align: "left" });
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827")
        .text("Backend Design & Logic Mapping");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED)
        .text("Area-wide GIS assets (drainage, sewer, water, roads, electrical) on top of the Property Survey platform.");
    doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.5);

    heading(doc, "1. Purpose");
    para(doc, "Extend the property-survey backend into a full digital asset register (\"digital twin\") of an area. Beyond parcels/buildings, the system now models point, line and polygon infrastructure across four categories, with an admin shapefile-ingest workflow, a layered map, and a field survey/correction loop for surveyors.");

    heading(doc, "2. Core data model");
    para(doc, "A generic, admin-configurable GIS schema. Adding a new asset type is data (a new AssetLayer row), not code.");
    bullets(doc, [
        "Project — the top-level container an admin creates; shapefile uploads, asset features and property surveys are scoped to it via project_id. The admin uploads all data into a chosen project.",
        "AssetCategory — grouping for the legend/report (e.g. Drainage & Sewer).",
        "AssetLayer — a layer/asset-type definition: geometry_type (POINT/LINESTRING/POLYGON), map style, and an attribute_schema that drives survey forms and shapefile mapping.",
        "AssetFeature — one geometry instance. geom is geometry(Geometry,4326) (true WGS84); cached length_m / area_sqm are geodesic. Lifecycle: STAGED → VERIFIED → PUBLISHED, plus FLAGGED / REJECTED.",
        "AssetUpload — one import batch (shapefile-zip or GeoJSON); the unit the admin reviews and publishes.",
        "AssetSurvey — a surveyor's field observation or proposed correction (new geometry / attributes), reviewed and applied by an admin.",
        "AssetPhoto — Cloudinary-hosted field photos on a feature/visit.",
    ]);

    heading(doc, "3. Seeded asset catalog", 2);
    table(doc, [
        { label: "Category", width: 150 },
        { label: "Layer", width: 200 },
        { label: "Geometry", width: 110 },
    ], SEED_LAYERS);

    heading(doc, "4. Admin workflow — upload → verify → publish");
    bullets(doc, [
        "Admin selects a project + layer and uploads a zipped shapefile (.shp/.dbf/.prj) or a GeoJSON (project_id is required).",
        "Server parses with shpjs and reprojects from the file's CRS (from .prj) to WGS84.",
        "Only geometries matching the layer's geometry_type are staged; mismatches are counted and skipped.",
        "Features land as STAGED under an AssetUpload; the admin reviews them on the map (GET uploads/:id/features).",
        "Verify → features VERIFIED. Publish → features PUBLISHED (live to surveyors). Reject/Delete discards the batch.",
    ]);

    heading(doc, "5. Surveyor workflow — survey & correct");
    bullets(doc, [
        "Surveyor opens the map; nearby published assets load via GET features/nearby (GPS + radius).",
        "For each asset they VERIFY, CORRECT_GEOMETRY (redraw), CORRECT_ATTRIBUTE, or FLAG a flaw, with condition + notes + photos.",
        "The proposal is stored on AssetSurvey and the feature is marked FLAGGED — it is NOT auto-applied.",
        "Admin approves → corrected geometry/attributes copied onto the feature, status back to PUBLISHED. Reject leaves it unchanged.",
    ]);

    heading(doc, "6. Layered map");
    para(doc, "GET /api/assets/map returns every active layer with its features grouped as GeoJSON plus the layer's draw style and attribute schema — the frontend renders one toggleable Leaflet overlay per layer. Filters: ward_id, bbox (viewport), status (PUBLISHED default; ALL for admin review).");

    heading(doc, "7. Geometry & CRS notes", 2);
    bullets(doc, [
        "New asset geometry is stored natively in EPSG:4326 and returned via ST_AsGeoJSON — no transform on read.",
        "Legacy note: existing Polygons store UTM 44N (EPSG:32644) coordinates and are transformed 32644→4326 on read; the two datasets stay separate.",
        "A GiST index on AssetFeatures.geom backs bbox and nearby (ST_DWithin) queries.",
    ]);

    heading(doc, "8. API map");
    table(doc, [
        { label: "Method", width: 70 },
        { label: "Path", width: 250 },
        { label: "Purpose", width: 190 },
    ], API_MAP);

    heading(doc, "9. Gaps & next steps");
    bullets(doc, [
        "Frontend: add a layer-toggle control + shapefile upload UI (website GIS dashboard) and asset survey screens (mobile app). Backend endpoints are ready.",
        "Auto-assign ward_id / polygon_id to imported features via a spatial join (ST_Contains) instead of a single ward per batch.",
        "Large imports: switch the per-feature INSERT loop to a batched/COPY insert for very large shapefiles.",
        "Attribute mapping UI: let the admin map .dbf columns to the layer's attribute_schema during upload.",
        "Topology validation (snap manholes to sewer ends, connectivity checks) as a verification aid.",
        "Versioning/audit trail on feature geometry edits (currently corrections are applied in place).",
    ]);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED)
        .text("Property Survey — Digital Asset backend. This document is generated by services/pdfService.js.", { align: "center" });
}

// ══════════════════════════════════════════════════════════════
// 2) WARD ASSET REPORT (with schematic vector map)
// ══════════════════════════════════════════════════════════════

function fmtLen(m) {
    if (!m) return "—";
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}
function fmtArea(a) {
    if (!a) return "—";
    return a >= 10000 ? `${(a / 10000).toFixed(2)} ha` : `${a.toFixed(0)} m²`;
}

/**
 * Draw a self-contained schematic map of the features into a box.
 * @param featureLayers [{ style, geometry_type, features:[GeoJSON Feature] }]
 * @param bbox [minLng,minLat,maxLng,maxLat]
 */
function drawSchematicMap(doc, featureLayers, bbox, box) {
    const { x, y, w, h } = box;
    // frame
    doc.save().rect(x, y, w, h).fillColor("#f8fafc").fill();
    doc.rect(x, y, w, h).strokeColor(RULE).lineWidth(1).stroke();

    if (!bbox || bbox[0] === bbox[2] || bbox[1] === bbox[3]) {
        doc.font("Helvetica").fontSize(9).fillColor(MUTED)
            .text("No geometry to plot.", x + 8, y + 8);
        doc.restore();
        return;
    }

    const pad = 12;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    // aspect-correct scaling (equirectangular)
    const latRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const spanX = (maxLng - minLng) * Math.cos(latRad);
    const spanY = maxLat - minLat;
    const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    const offX = x + (w - spanX * scale) / 2;
    const offY = y + (h - spanY * scale) / 2;
    const project = ([lng, lat]) => [
        offX + (lng - minLng) * Math.cos(latRad) * scale,
        // invert Y: north is up
        offY + (maxLat - lat) * scale,
    ];

    const drawGeom = (geom, style, geomType) => {
        if (!geom) return;
        const color = style.color || "#334155";
        const eachLine = (coords) => {
            doc.moveTo(...project(coords[0]));
            for (let i = 1; i < coords.length; i++) doc.lineTo(...project(coords[i]));
        };
        if (geom.type === "Point") {
            const [px, py] = project(geom.coordinates);
            doc.circle(px, py, 1.8).fillColor(color).fill();
        } else if (geom.type === "MultiPoint") {
            geom.coordinates.forEach((c) => {
                const [px, py] = project(c);
                doc.circle(px, py, 1.8).fillColor(color).fill();
            });
        } else if (geom.type === "LineString") {
            eachLine(geom.coordinates);
            doc.strokeColor(color).lineWidth(style.weight ? Math.min(style.weight, 2) : 1).stroke();
        } else if (geom.type === "MultiLineString") {
            geom.coordinates.forEach((l) => {
                eachLine(l);
                doc.strokeColor(color).lineWidth(style.weight ? Math.min(style.weight, 2) : 1).stroke();
            });
        } else if (geom.type === "Polygon") {
            geom.coordinates.forEach((ring) => {
                eachLine(ring);
                doc.closePath();
            });
            doc.fillColor(style.fillColor || color).fillOpacity(style.fillOpacity ?? 0.3).fill();
            doc.fillOpacity(1);
            geom.coordinates.forEach((ring) => eachLine(ring));
            doc.strokeColor(color).lineWidth(1).stroke();
        } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach((poly) =>
                drawGeom({ type: "Polygon", coordinates: poly }, style, geomType)
            );
        }
    };

    // clip to the box so nothing spills over the frame
    doc.save().rect(x, y, w, h).clip();
    featureLayers.forEach((L) => {
        (L.features || []).forEach((f) => drawGeom(f.geometry, L.style || {}, L.geometry_type));
    });
    doc.restore();
    doc.restore();
}

/**
 * @param doc PDFDocument
 * @param data {
 *   ward: { ward_name, ward_number } | null,
 *   generatedFor: string,
 *   stats: [ per-layer stat rows from getAssetStats ],
 *   featureLayers: [{ name, style, geometry_type, features:[GeoJSON Feature] }],
 *   bbox: [minLng,minLat,maxLng,maxLat] | null
 * }
 */
function writeWardReport(doc, data) {
    const { ward, stats = [], featureLayers = [], bbox = null, generatedFor = "" } = data;

    doc.font("Helvetica-Bold").fontSize(22).fillColor(BRAND).text("Area Asset Report");
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827")
        .text(ward ? `${ward.ward_name}${ward.ward_number ? ` (Ward ${ward.ward_number})` : ""}` : generatedFor || "All wards");
    doc.font("Helvetica").fontSize(9).fillColor(MUTED)
        .text(`Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
    doc.moveDown(0.6);

    // Summary tiles
    const totalFeatures = stats.reduce((s, r) => s + Number(r.feature_count || 0), 0);
    const totalLen = stats.reduce((s, r) => s + Number(r.total_length_m || 0), 0);
    const totalPublished = stats.reduce((s, r) => s + Number(r.published || 0), 0);
    const totalFlagged = stats.reduce((s, r) => s + Number(r.flagged || 0), 0);
    para(doc,
        `Features: ${totalFeatures}   ·   Network length: ${fmtLen(totalLen)}   ·   Published: ${totalPublished}   ·   Flagged: ${totalFlagged}`
    );

    // Schematic map
    heading(doc, "Asset map (schematic)", 2);
    const left = doc.page.margins.left;
    const w = doc.page.width - left - doc.page.margins.right;
    drawSchematicMap(doc, featureLayers, bbox, { x: left, y: doc.y, w, h: 280 });
    doc.y += 290;

    // Inventory table
    heading(doc, "Inventory by layer", 2);
    const rows = stats.map((r) => [
        r.category_name || "—",
        r.layer_name,
        r.geometry_type,
        String(r.feature_count),
        r.geometry_type === "LINESTRING" ? fmtLen(Number(r.total_length_m)) : "—",
        r.geometry_type === "POLYGON" ? fmtArea(Number(r.total_area_sqm)) : "—",
        String(r.published),
        String(r.flagged),
    ]);
    table(doc, [
        { label: "Category", width: 95 },
        { label: "Layer", width: 105 },
        { label: "Geom", width: 60 },
        { label: "Count", width: 42 },
        { label: "Length", width: 60 },
        { label: "Area", width: 55 },
        { label: "Live", width: 40 },
        { label: "Flagged", width: 45 },
    ], rows);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED)
        .text("Schematic map is a vector plot of stored geometry (no basemap). For an interactive map use the app.", { align: "center" });
}

module.exports = { writeDesignDoc, writeWardReport };
