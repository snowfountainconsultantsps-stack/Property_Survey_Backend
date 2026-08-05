// ════════════════════════════════════════════════════════════════
// Wipes the whole location hierarchy so it can be re-entered from scratch,
// WITHOUT destroying surveyed data.
//
//   node scripts/resetLocations.js
//
// Wards cascade-delete Polygons and AssetFeatures, which in turn cascade into
// Properties/Surveys. So the parcels and features are detached first
// (ward_id → NULL) and only then are the location rows removed.
//
// Survives: Polygons, AssetFeatures, Properties, Surveys, tax assessments,
//           uploads, projects.
// Removed:  States, Districts, Cities, Ulbs, Zones, Wards, Localities.
//
// Afterwards every parcel has ward_id = NULL — re-link them with
// scripts/relinkWard.js once the new hierarchy exists.
// ════════════════════════════════════════════════════════════════
const { sequelize } = require("../models");

(async () => {
    const t = await sequelize.transaction();
    try {
        const q = (sql, opts = {}) =>
            sequelize.query(sql, { transaction: t, type: sequelize.QueryTypes.SELECT, ...opts });
        const run = (sql) => sequelize.query(sql, { transaction: t });

        const before = {};
        for (const tbl of ["Polygons", "AssetFeatures", "Properties", "Surveys", "PropertyTaxAssessments"]) {
            before[tbl] = (await q(`SELECT COUNT(*)::int n FROM "${tbl}"`))[0].n;
        }
        console.log("Before:", JSON.stringify(before));

        // 1. Polygons.ward_id is NOT NULL — a parcel must be allowed to exist
        //    without a ward while the hierarchy is being rebuilt.
        await run('ALTER TABLE "Polygons" ALTER COLUMN "ward_id" DROP NOT NULL;');

        // 2. Detach everything that would otherwise be cascade-deleted.
        const [, poly] = await sequelize.query(
            'UPDATE "Polygons" SET ward_id = NULL WHERE ward_id IS NOT NULL',
            { transaction: t }
        );
        const [, feat] = await sequelize.query(
            'UPDATE "AssetFeatures" SET ward_id = NULL WHERE ward_id IS NOT NULL',
            { transaction: t }
        );
        console.log(`Detached: ${poly?.rowCount ?? 0} polygons, ${feat?.rowCount ?? 0} asset features`);

        // 3. Projects point at location rows too — clear the dangling links.
        const [, proj] = await sequelize.query(
            `UPDATE "Projects" SET state_id = NULL, district_id = NULL, city_id = NULL,
                                   ulb_id = NULL, ward_id = NULL
             WHERE state_id IS NOT NULL OR district_id IS NOT NULL OR city_id IS NOT NULL
                OR ulb_id IS NOT NULL OR ward_id IS NOT NULL`,
            { transaction: t }
        );
        console.log(`Cleared location links on ${proj?.rowCount ?? 0} project(s)`);

        // 4. Now safe to delete, children first.
        for (const tbl of ["Localities", "Wards", "Zones", "Ulbs", "Cities", "Districts", "States"]) {
            await run(`DELETE FROM "${tbl}"`);
            // Restart ids so the fresh hierarchy numbers from 1.
            await run(`ALTER SEQUENCE IF EXISTS "${tbl}_id_seq" RESTART WITH 1;`).catch(() => {});
            console.log(`  cleared ${tbl}`);
        }

        // 5. Confirm nothing else was lost.
        const after = {};
        for (const tbl of ["Polygons", "AssetFeatures", "Properties", "Surveys", "PropertyTaxAssessments"]) {
            after[tbl] = (await q(`SELECT COUNT(*)::int n FROM "${tbl}"`))[0].n;
        }
        console.log("After :", JSON.stringify(after));

        const lost = Object.keys(before).filter((k) => before[k] !== after[k]);
        if (lost.length) {
            throw new Error(
                `Data loss detected in: ${lost.map((k) => `${k} ${before[k]}→${after[k]}`).join(", ")}`
            );
        }

        await t.commit();
        console.log("\n✅ Locations cleared. All survey data intact.");
        console.log("   Every parcel now has ward_id = NULL.");
        console.log("   Rebuild State → District → ULB → [Zone] → Ward in the admin UI,");
        console.log("   then run:  node scripts/relinkWard.js <newWardId>");
    } catch (e) {
        await t.rollback();
        console.error("❌ Rolled back — nothing changed. Reason:", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
