// ════════════════════════════════════════════════════════════════
// Deletes ALL operational data — projects, uploaded assets, parcels, property
// surveys, tax assessments and surveyor allocations — leaving an empty system.
//
//   node scripts/wipeAllData.js
//
// KEPT deliberately:
//   • Users            — wiping these would lock you out of the admin.
//   • AssetCategories / AssetLayers  — the asset catalog is configuration and
//     is re-seeded on every boot anyway.
//   • PropertyTypeConfigs            — the per-category question schemas.
//   • Locations (State…Locality)     — already cleared separately; run
//     scripts/resetLocations.js if any remain.
//
// Runs in one transaction: any failure rolls the whole thing back.
// ════════════════════════════════════════════════════════════════
const { sequelize } = require("../models");

// Children before parents. Several FKs cascade, but being explicit keeps the
// order correct regardless of how each constraint was declared.
const ORDER = [
    "PropertyTaxAssessments",
    "UnitPhotos", "UnitUtilities", "UnitOwners", "Units",
    "FloorOccupancies", "FloorUtilities", "Floors",
    "Buildings",
    "PropertyPhotos", "PropertyRoads", "PropertyUtilities", "PropertyOwners",
    "Surveys", "Properties",
    "AssetPhotos", "AssetSurveys", "AssetFeatures", "AssetUploads",
    "Polygons",
    "SurveyorAssignments",
    "Projects",
];

const KEPT = ["Users", "AssetCategories", "AssetLayers", "PropertyTypeConfigs"];

(async () => {
    const t = await sequelize.transaction();
    try {
        const q = (sql) => sequelize.query(sql, { transaction: t, type: sequelize.QueryTypes.SELECT });

        let deleted = 0;
        for (const table of ORDER) {
            const before = (await q(`SELECT COUNT(*)::int n FROM "${table}"`))[0].n;
            if (!before) continue;
            await sequelize.query(`DELETE FROM "${table}"`, { transaction: t });
            // Restart ids so a fresh dataset numbers from 1.
            await sequelize
                .query(`ALTER SEQUENCE IF EXISTS "${table}_id_seq" RESTART WITH 1`, { transaction: t })
                .catch(() => {});
            deleted += before;
            console.log(`  cleared ${table.padEnd(24)} (${before})`);
        }

        // Nothing should remain in any wiped table.
        const leftovers = [];
        for (const table of ORDER) {
            const n = (await q(`SELECT COUNT(*)::int n FROM "${table}"`))[0].n;
            if (n) leftovers.push(`${table}=${n}`);
        }
        if (leftovers.length) throw new Error(`Not empty after wipe: ${leftovers.join(", ")}`);

        await t.commit();
        console.log(`\n✅ Wiped ${deleted} rows across ${ORDER.length} tables.`);

        console.log("\nKept (configuration):");
        for (const table of KEPT) {
            const rows = await sequelize.query(`SELECT COUNT(*)::int n FROM "${table}"`, {
                type: sequelize.QueryTypes.SELECT,
            });
            console.log(`  ${table.padEnd(24)} ${rows[0].n}`);
        }
        console.log("\nThe system is now empty. Create a project, then upload data into it.");
    } catch (e) {
        await t.rollback();
        console.error("❌ Rolled back — nothing was deleted. Reason:", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
