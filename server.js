const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const { sequelize } = require("./models");
const { errorHandler } = require("./middleware/errorHandler");
const createDefaultAdmin = require("./config/createDefaultAdmin");
const seedAssetCatalog = require("./config/seedAssetCatalog");
const seedPropertyTypeConfig = require("./config/seedPropertyTypeConfig");

// Route imports
const authRoutes = require("./routes/authRoutes");
const propertyRoutes = require("./routes/propertyRoutes");
const surveyRoutes = require("./routes/surveyRoutes");
const gisRoutes = require("./routes/gisRoutes");
const wizardRoutes = require("./routes/wizardRoutes");
const typesRoutes = require("./routes/typesRoutes");
const assetRoutes = require("./routes/assetRoutes");
const projectRoutes = require("./routes/projectRoutes");
const boundaryRoutes = require("./routes/boundaryRoutes");
const locationRoutes = require("./routes/locationRoutes");
const taxRoutes = require("./routes/taxRoutes");

const app = express();

// ──────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// ──────────────────────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "ok",
        message: "Property Survey Backend is running.",
        timestamp: new Date().toISOString(),
    });
});

// ──────────────────────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/types", typesRoutes);
// Wizard routes MUST come before generic surveyRoutes to avoid /:id collisions
app.use("/api/surveys", wizardRoutes);
app.use("/api/surveys", surveyRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/gis", gisRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/boundaries", boundaryRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/tax", taxRoutes);

// ──────────────────────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found.`,
    });
});

// ──────────────────────────────────────────────────────────────
// Global Error Handler
// ──────────────────────────────────────────────────────────────
app.use(errorHandler);

// ──────────────────────────────────────────────────────────────
// Database Sync & Start Server
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await sequelize.authenticate();
        console.log("✅ PostgreSQL (Supabase) connected successfully.");

        // Sync all models — creates tables/columns if they don't exist.
        // Keep alter:false — alter:true makes Postgres rewrite existing ENUM
        // columns with `ALTER TYPE ... USING`, which Sequelize emits with invalid
        // syntax ("syntax error at or near USING") and breaks startup.
        await sequelize.sync({ alter: false });
        console.log("✅ All models synchronized.");

        // Lightweight idempotent migrations for additive columns (sync runs with
        // alter:false, so new columns are not auto-created on existing tables).
        await sequelize.query(
            'ALTER TABLE "Properties" ADD COLUMN IF NOT EXISTS "property_code" VARCHAR;'
        );
        // Wizard resume position — see models/survey.js.
        await sequelize.query(
            'ALTER TABLE "Surveys" ADD COLUMN IF NOT EXISTS "current_step" INTEGER DEFAULT 1;'
        );
        // Project administrative-scope links (State → District → City → ULB).
        for (const col of ["state_id", "district_id", "ulb_id"]) {
            await sequelize.query(
                `ALTER TABLE "Projects" ADD COLUMN IF NOT EXISTS "${col}" INTEGER;`
            );
        }
        // Hierarchy move: State → District → ULB → [Zone] → Ward → Locality.
        // The ULB is now the operational parent (it defines wards and levies
        // the tax); City is demoted to an optional label on the ULB. Old
        // city_id columns are left in place so historic rows keep their value.
        await sequelize.query('ALTER TABLE "Ulbs"  ADD COLUMN IF NOT EXISTS "district_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Ulbs"  ALTER COLUMN "city_id" DROP NOT NULL;');
        await sequelize.query('ALTER TABLE "Zones" ADD COLUMN IF NOT EXISTS "ulb_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Zones" ALTER COLUMN "city_id" DROP NOT NULL;');
        await sequelize.query('ALTER TABLE "Wards" ADD COLUMN IF NOT EXISTS "ulb_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Wards" ALTER COLUMN "city_id" DROP NOT NULL;');
        for (const idx of [
            ['ulbs_district_idx', '"Ulbs" (district_id)'],
            ['zones_ulb_idx', '"Zones" (ulb_id)'],
            ['wards_ulb_idx', '"Wards" (ulb_id)'],
            ['localities_ward_idx', '"Localities" (ward_id)'],
        ]) {
            await sequelize.query(`CREATE INDEX IF NOT EXISTS "${idx[0]}" ON ${idx[1]};`).catch(() => {});
        }

        // Answers to the per-category questions defined in PropertyTypeConfig
        // (e.g. a petrol pump's canopy/forecourt areas). JSONB so new questions
        // never need another migration.
        for (const tbl of ["Properties", "Units"]) {
            await sequelize.query(
                `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "type_specific_attributes" JSONB DEFAULT '{}'::jsonb;`
            );
        }
        console.log("✅ Additive column migrations applied.");

        // ── Digital-asset spatial columns + indexes ──────────────
        // The geometry columns are intentionally NOT declared in Sequelize
        // (they are handled via raw PostGIS SQL), so add them here idempotently
        // together with the GiST indexes that back bbox / nearby queries.
        try {
            await sequelize.query("CREATE EXTENSION IF NOT EXISTS postgis;");
            await sequelize.query(
                'ALTER TABLE "AssetFeatures" ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);'
            );
            await sequelize.query(
                'ALTER TABLE "AssetSurveys" ADD COLUMN IF NOT EXISTS new_geom geometry(Geometry, 4326);'
            );
            await sequelize.query(
                'CREATE INDEX IF NOT EXISTS "asset_features_geom_gix" ON "AssetFeatures" USING GIST (geom);'
            );
            await sequelize.query(
                'CREATE INDEX IF NOT EXISTS "asset_features_layer_status_idx" ON "AssetFeatures" (layer_id, status);'
            );
            console.log("✅ Digital-asset spatial columns/indexes ready.");
        } catch (e) {
            console.warn("⚠️  Digital-asset spatial migration skipped:", e.message);
        }

        // ── Zone tier: State → District → City → Zone → Ward ─────────
        // Additive column + a one-time backfill that turns each distinct
        // legacy Ward.zone string into a real Zone row and links the ward.
        try {
            await sequelize.query(
                'ALTER TABLE "Wards" ADD COLUMN IF NOT EXISTS "zone_id" INTEGER;'
            );
            await sequelize.query(
                'CREATE INDEX IF NOT EXISTS "wards_zone_idx" ON "Wards" (zone_id);'
            );

            // Idempotent: only wards that still have a zone name but no zone_id.
            await sequelize.query(`
                INSERT INTO "Zones" (city_id, name, is_active, "createdAt", "updatedAt")
                SELECT DISTINCT w.city_id, TRIM(w.zone), true, NOW(), NOW()
                FROM "Wards" w
                WHERE w.zone IS NOT NULL AND TRIM(w.zone) <> '' AND w.zone_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM "Zones" z
                    WHERE z.city_id = w.city_id AND LOWER(z.name) = LOWER(TRIM(w.zone))
                  );
            `);
            const [, backfill] = await sequelize.query(`
                UPDATE "Wards" w
                SET zone_id = z.id
                FROM "Zones" z
                WHERE w.zone_id IS NULL
                  AND w.zone IS NOT NULL AND TRIM(w.zone) <> ''
                  AND z.city_id = w.city_id
                  AND LOWER(z.name) = LOWER(TRIM(w.zone));
            `);
            const linked = backfill?.rowCount ?? 0;
            console.log(
                `✅ Zone tier ready${linked ? ` (${linked} ward(s) linked from legacy zone names)` : ""}.`
            );
        } catch (e) {
            console.warn("⚠️  Zone tier migration skipped:", e.message);
        }

        // ── Location-hierarchy boundaries ────────────────────────
        // Same pattern as the digital-asset geometry columns above: raw,
        // additive, not declared in Sequelize — all I/O goes through
        // services/locationGeo.js. Localities are included because a locality
        // MAY carry a boundary (enabling spatial assignment); where no
        // shapefile exists the column simply stays NULL and it's just a name.
        try {
            for (const tbl of ["States", "Districts", "Cities", "Ulbs", "Zones", "Wards", "Localities"]) {
                await sequelize.query(
                    `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS boundary geometry(Geometry, 4326);`
                );
                await sequelize.query(
                    `CREATE INDEX IF NOT EXISTS "${tbl.toLowerCase()}_boundary_gix" ON "${tbl}" USING GIST (boundary);`
                );
            }
            console.log("✅ Location boundary columns/indexes ready.");
        } catch (e) {
            console.warn("⚠️  Location boundary migration skipped:", e.message);
        }

        // ── Project scoping: additive project_id on existing tables ──
        // (sync runs alter:false, so these columns are not auto-added.)
        try {
            for (const tbl of ["AssetFeatures", "AssetUploads", "Polygons", "Properties", "Surveys"]) {
                await sequelize.query(
                    `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "project_id" INTEGER;`
                );
            }
            await sequelize.query(
                'CREATE INDEX IF NOT EXISTS "asset_features_project_idx" ON "AssetFeatures" (project_id);'
            );
            console.log("✅ Project scoping columns ready.");
        } catch (e) {
            console.warn("⚠️  Project scoping migration skipped:", e.message);
        }

        await createDefaultAdmin();
        await seedAssetCatalog();
        await seedPropertyTypeConfig();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
        });
    } catch (error) {
        console.error("❌ Unable to connect to the database:", error.message);
        process.exit(1);
    }
};

startServer();

module.exports = app;
