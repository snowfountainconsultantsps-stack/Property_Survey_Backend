// Applies the property-type-config schema without restarting the API server:
//   • creates the PropertyTypeConfigs table
//   • adds type_specific_attributes JSONB to Properties / Units
//   • seeds the 7 leaf type configurations
//
//   node scripts/migrateTypeConfig.js [--force-schemas]
const { sequelize, PropertyTypeConfig } = require("../models");
const seedPropertyTypeConfig = require("../config/seedPropertyTypeConfig");

(async () => {
    try {
        await sequelize.authenticate();

        await PropertyTypeConfig.sync();
        console.log('✅ "PropertyTypeConfigs" table ready.');

        for (const tbl of ["Properties", "Units"]) {
            await sequelize.query(
                `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "type_specific_attributes" JSONB DEFAULT '{}'::jsonb;`
            );
        }
        console.log("✅ type_specific_attributes columns ready.");

        const force = process.argv.includes("--force-schemas");
        const { created, updated } = await seedPropertyTypeConfig({ force });
        console.log(`✅ Seed complete — ${created} created, ${updated} updated${force ? " (schemas forced)" : ""}.`);

        const rows = await PropertyTypeConfig.findAll({ order: [["sort_order", "ASC"]] });
        console.log("\nConfigured property types:");
        for (const r of rows) {
            const qs = Array.isArray(r.attribute_schema) ? r.attribute_schema.length : 0;
            console.log(
                `  ${String(r.label).padEnd(38)} ${r.structural_template.padEnd(7)} ` +
                `multi=${r.is_multi_entry ? "Y" : "N"} photos=${r.collects_photos ? "Y" : "N"}  ${qs} questions`
            );
        }
    } catch (e) {
        console.error("FATAL", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
