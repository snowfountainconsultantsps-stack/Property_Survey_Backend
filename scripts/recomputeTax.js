// ════════════════════════════════════════════════════════════════
// Recomputes every stored tax assessment with the current engine.
//
//   node scripts/recomputeTax.js
//
// Stored breakdowns are frozen at approval time, so engine changes (owner-wise
// split, petrol-pump canopy/forecourt spaces, …) don't reach already-approved
// records. This refreshes them in place, keeping their APPROVED status.
// ════════════════════════════════════════════════════════════════
const {
    sequelize, Property, PropertyUtilities, Building, Floor, Unit, UnitOwner,
    FloorOccupancy, PropertyTaxAssessment,
} = require("../models");
const { computeTax } = require("../services/taxCalculator");

// Mirrors taxController.buildProperty — explicit per-table reads so we don't
// depend on Sequelize's default association aliases.
async function buildProperty(propertyId) {
    const property = await Property.findByPk(propertyId);
    if (!property) return null;

    const [util, building] = await Promise.all([
        PropertyUtilities.findOne({ where: { property_id: propertyId } }),
        Building.findOne({ where: { property_id: propertyId } }),
    ]);

    let floors = [];
    if (building) {
        const floorRows = await Floor.findAll({
            where: { building_id: building.id },
            order: [["floor_number", "ASC"]],
        });
        floors = await Promise.all(
            floorRows.map(async (f) => {
                const [units, occ] = await Promise.all([
                    Unit.findAll({ where: { floor_id: f.id } }),
                    FloorOccupancy.findOne({ where: { floor_id: f.id } }),
                ]);
                const withOwners = await Promise.all(
                    units.map(async (u) => ({
                        ...u.toJSON(),
                        UnitOwners: (await UnitOwner.findAll({ where: { unit_id: u.id } }))
                            .map((o) => o.toJSON()),
                    }))
                );
                return {
                    ...f.toJSON(),
                    Units: withOwners,
                    FloorOccupancy: occ ? occ.toJSON() : null,
                };
            })
        );
    }

    return {
        ...property.toJSON(),
        sewer_connection: !!util?.sewer_connection,
        Building: building ? { ...building.toJSON(), Floors: floors } : null,
    };
}

(async () => {
    try {
        const rows = await PropertyTaxAssessment.findAll({ order: [["property_id", "ASC"]] });
        console.log(`Recomputing ${rows.length} assessment(s)…`);

        let changed = 0;
        let withOwners = 0;
        for (const row of rows) {
            const property = await buildProperty(row.property_id);
            if (!property) {
                console.log(`  ⚠️  property ${row.property_id} missing — skipped`);
                continue;
            }
            const breakdown = computeTax(property);
            const before = Number(row.total_amount);
            await row.update({
                assessment_year: breakdown.assessment_year,
                arv: breakdown.arv_total,
                total_amount: breakdown.total_annual,
                breakdown,
            });
            if (Math.abs(before - breakdown.total_annual) > 0.01) changed += 1;
            if (breakdown.owner_breakdown?.length) withOwners += 1;
            process.stdout.write(".");
        }

        console.log(`\n✅ Done. ${rows.length} refreshed, ${withOwners} now carry an owner-wise split.`);
        if (changed) console.log(`   ${changed} had their total change (engine now prices more spaces).`);

        const sample = await sequelize.query(
            `SELECT p.property_code, p.property_subtype, a.total_amount,
                    jsonb_array_length(COALESCE(a.breakdown->'owner_breakdown','[]'::jsonb)) owners
             FROM "PropertyTaxAssessments" a JOIN "Properties" p ON p.id = a.property_id
             WHERE p.property_subtype IN ('CommercialComplex','MultiStory')
             ORDER BY a.total_amount DESC LIMIT 5`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log("\nTop multi-unit properties:");
        sample.forEach((s) =>
            console.log(`  ${s.property_code}  ${s.property_subtype.padEnd(18)} ₹${Number(s.total_amount).toLocaleString("en-IN").padStart(12)}  · ${s.owners} owner group(s)`)
        );
    } catch (e) {
        console.error("FATAL", e.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
