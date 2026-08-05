// ════════════════════════════════════════════════════════════════
// Re-attaches detached parcels and asset features to a ward after the
// location hierarchy has been rebuilt.
//
//   node scripts/relinkWard.js <wardId>
//   node scripts/relinkWard.js            → lists the wards to choose from
//
// Everything was under a single ward before the reset, so a straight
// assignment is correct. Only rows with ward_id IS NULL are touched, so this
// never steals data that already belongs to another ward.
// ════════════════════════════════════════════════════════════════
const { sequelize, Ward } = require("../models");

(async () => {
    try {
        const wardId = process.argv[2];

        if (!wardId) {
            const wards = await sequelize.query(
                `SELECT w.id, w.ward_name, w.ward_number, u.name AS ulb
                 FROM "Wards" w LEFT JOIN "Ulbs" u ON w.ulb_id = u.id
                 ORDER BY w.id`,
                { type: sequelize.QueryTypes.SELECT }
            );
            if (!wards.length) {
                console.log("No wards exist yet — create the hierarchy first.");
            } else {
                console.log("Available wards:");
                wards.forEach((w) =>
                    console.log(`  ${w.id}  ${w.ward_name} (${w.ward_number || "-"})  · ULB: ${w.ulb || "—"}`)
                );
                console.log("\nRe-run with:  node scripts/relinkWard.js <wardId>");
            }
            return;
        }

        const ward = await Ward.findByPk(wardId);
        if (!ward) {
            console.error(`❌ Ward ${wardId} not found.`);
            process.exitCode = 1;
            return;
        }

        const [, poly] = await sequelize.query(
            "UPDATE \"Polygons\" SET ward_id = :id WHERE ward_id IS NULL",
            { replacements: { id: ward.id } }
        );
        const [, feat] = await sequelize.query(
            "UPDATE \"AssetFeatures\" SET ward_id = :id WHERE ward_id IS NULL",
            { replacements: { id: ward.id } }
        );

        console.log(`✅ Linked to ward ${ward.id} "${ward.ward_name}":`);
        console.log(`   ${poly?.rowCount ?? 0} polygons`);
        console.log(`   ${feat?.rowCount ?? 0} asset features`);
    } catch (e) {
        console.error("FATAL", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
