// ════════════════════════════════════════════════════════════════
// Moves the location hierarchy from
//     State → District → City → Zone → Ward
// to
//     State → District → ULB → [Zone] → Ward → Locality
//
//   node scripts/migrateHierarchy.js
//
// Safe to re-run. Nothing is deleted: legacy city_id values stay put, and
// Polygons/Properties/Surveys are untouched because they hang off ward_id,
// which keeps its identity throughout.
// ════════════════════════════════════════════════════════════════
const { sequelize, City, Ulb, Zone, Ward, Locality } = require("../models");

// Any ULB rows the existing cities imply. Where a city has wards but no ULB
// yet, one is created so the chain is never broken.
const DEFAULT_ULB_TYPE = "Municipal Corporation";

(async () => {
    try {
        await sequelize.authenticate();

        // Ensure the table + columns exist even if the API server hasn't been
        // restarted since the model changes landed.
        await Locality.sync();
        await sequelize.query('ALTER TABLE "Ulbs"  ADD COLUMN IF NOT EXISTS "district_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Ulbs"  ALTER COLUMN "city_id" DROP NOT NULL;');
        await sequelize.query('ALTER TABLE "Zones" ADD COLUMN IF NOT EXISTS "ulb_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Zones" ALTER COLUMN "city_id" DROP NOT NULL;');
        await sequelize.query('ALTER TABLE "Wards" ADD COLUMN IF NOT EXISTS "ulb_id" INTEGER;');
        await sequelize.query('ALTER TABLE "Wards" ALTER COLUMN "city_id" DROP NOT NULL;');
        await sequelize.query(
            'ALTER TABLE "Localities" ADD COLUMN IF NOT EXISTS boundary geometry(Geometry, 4326);'
        ).catch(() => {});
        console.log("✅ Schema ready.");

        // 1. Give every ULB a district (derive from its city when missing).
        const [, ulbFix] = await sequelize.query(`
            UPDATE "Ulbs" u SET district_id = c.district_id
            FROM "Cities" c
            WHERE u.city_id = c.id AND u.district_id IS NULL
        `);
        console.log(`• ULBs given a district: ${ulbFix?.rowCount ?? 0}`);

        // 2. Every city that still has wards/zones but no ULB needs one, or
        //    those wards would have no taxing authority after the move.
        const cities = await City.findAll();
        let ulbsCreated = 0;
        for (const city of cities) {
            const wardCount = await Ward.count({ where: { city_id: city.id } });
            const zoneCount = await Zone.count({ where: { city_id: city.id } });
            if (wardCount === 0 && zoneCount === 0) continue;

            const existing = await Ulb.findOne({ where: { city_id: city.id } });
            if (existing) continue;

            await Ulb.create({
                name: `${city.name} Nagar Nigam`,
                district_id: city.district_id,
                city_id: city.id,
                ulb_type: DEFAULT_ULB_TYPE,
                is_active: true,
            });
            ulbsCreated += 1;
            console.log(`• Created ULB for "${city.name}" (had ${wardCount} ward(s), ${zoneCount} zone(s))`);
        }
        if (!ulbsCreated) console.log("• No new ULBs needed.");

        // 3. Point zones and wards at their city's ULB.
        //    Where a city somehow has several ULBs, the oldest wins — an
        //    arbitrary but deterministic choice, reported below so it can be
        //    corrected by hand.
        const [, zoneFix] = await sequelize.query(`
            UPDATE "Zones" z SET ulb_id = u.id
            FROM (SELECT DISTINCT ON (city_id) city_id, id FROM "Ulbs" ORDER BY city_id, id) u
            WHERE z.city_id = u.city_id AND z.ulb_id IS NULL
        `);
        console.log(`• Zones linked to a ULB: ${zoneFix?.rowCount ?? 0}`);

        // Wards inside a zone follow that zone's ULB…
        const [, wardViaZone] = await sequelize.query(`
            UPDATE "Wards" w SET ulb_id = z.ulb_id
            FROM "Zones" z
            WHERE w.zone_id = z.id AND w.ulb_id IS NULL AND z.ulb_id IS NOT NULL
        `);
        // …and zone-less wards fall back to their city's ULB.
        const [, wardViaCity] = await sequelize.query(`
            UPDATE "Wards" w SET ulb_id = u.id
            FROM (SELECT DISTINCT ON (city_id) city_id, id FROM "Ulbs" ORDER BY city_id, id) u
            WHERE w.city_id = u.city_id AND w.ulb_id IS NULL
        `);
        console.log(
            `• Wards linked to a ULB: ${(wardViaZone?.rowCount ?? 0) + (wardViaCity?.rowCount ?? 0)}` +
            ` (${wardViaZone?.rowCount ?? 0} via zone, ${wardViaCity?.rowCount ?? 0} via city)`
        );

        // 4. Report anything still unparented — these need manual attention.
        const orphanWards = await sequelize.query(
            `SELECT id, ward_name FROM "Wards" WHERE ulb_id IS NULL`,
            { type: sequelize.QueryTypes.SELECT }
        );
        const multiUlbCities = await sequelize.query(
            `SELECT city_id, COUNT(*)::int n FROM "Ulbs" WHERE city_id IS NOT NULL
             GROUP BY city_id HAVING COUNT(*) > 1`,
            { type: sequelize.QueryTypes.SELECT }
        );

        console.log("\n── Result ─────────────────────────────────");
        const rows = await sequelize.query(
            `SELECT s.name AS state, d.name AS district, u.name AS ulb, u.ulb_type,
                    z.name AS zone, w.ward_name, w.ward_number,
                    (SELECT COUNT(*)::int FROM "Localities" l WHERE l.ward_id = w.id) localities
             FROM "Wards" w
             LEFT JOIN "Ulbs" u      ON w.ulb_id = u.id
             LEFT JOIN "Zones" z     ON w.zone_id = z.id
             LEFT JOIN "Districts" d ON u.district_id = d.id
             LEFT JOIN "States" s    ON d.state_id = s.id
             ORDER BY w.id`,
            { type: sequelize.QueryTypes.SELECT }
        );
        for (const r of rows) {
            console.log(
                `  ${r.state} → ${r.district} → ${r.ulb || "(no ULB!)"} → ` +
                `${r.zone || "(no zone)"} → ${r.ward_name} [${r.localities} localities]`
            );
        }

        if (orphanWards.length) {
            console.log(`\n⚠️  ${orphanWards.length} ward(s) still have no ULB:`);
            orphanWards.forEach((w) => console.log(`   - #${w.id} ${w.ward_name}`));
        }
        if (multiUlbCities.length) {
            console.log(`\n⚠️  ${multiUlbCities.length} city/cities have multiple ULBs — verify the`);
            console.log("   automatic assignment above picked the right one for each ward.");
        }
        console.log("\n✅ Hierarchy migration complete.");
    } catch (e) {
        console.error("FATAL", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
