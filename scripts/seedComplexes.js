// ════════════════════════════════════════════════════════════════
// Seed a section of NonResidential CommercialComplex parcels:
//   • each: 1 basement (parking) + 4 above-ground floors of shops/offices
//   • in 5 of them, one owner holds MORE THAN ONE unit in the complex
// Additive — does NOT delete existing data. Codes: LKOCC001…
//
//   node scripts/seedComplexes.js
// ════════════════════════════════════════════════════════════════
const {
    sequelize, Property, Survey, PropertyOwner, PropertyUtilities, PropertyRoad,
    Building, Floor, Unit, UnitOwner, UnitUtilities, PropertyTaxAssessment,
} = require("../models");
const { computeTax } = require("../services/taxCalculator");

const PROJECT_ID = 2;
const PROPERTY_LAYER = 15;
const ADMIN = "a7089077-3bad-4290-b23c-1f07650caa20";
const SURVEYORS = ["893d6552-986a-4ce6-a707-c7a956a2d307", "334e2a88-902d-4f33-a841-dd322a46dad7"];
const CLUSTER = { lng: 80.945, lat: 26.828 };
const N_COMPLEXES = 8;
const N_MULTI_OWNER = 5; // complexes where one owner holds >1 unit

const maleFirst = ["Ram Prasad", "Suresh", "Rajesh", "Anil", "Vijay", "Manoj", "Sanjay", "Amit", "Deepak", "Ravi", "Sunil", "Ashok", "Naresh", "Pramod", "Arun", "Vinod", "Gopal", "Mohan", "Mukesh", "Satish", "Ramesh", "Om Prakash", "Jagdish"];
const lastNames = ["Verma", "Sharma", "Gupta", "Yadav", "Singh", "Srivastava", "Tiwari", "Mishra", "Agarwal", "Shukla", "Rastogi", "Saxena", "Nigam", "Bajpai"];
const occupations = ["Business", "Trader", "Shopkeeper", "Wholesaler", "Distributor", "Contractor", "Self-employed"];
const mohallas = ["Gangaram Purwa", "Shivaji Marg", "Nehru Nagar", "Rajendra Nagar", "Ashok Vihar", "Subhash Marg", "Tilak Road", "Vikas Khand"];
const remarks = ["Commercial complex assessed unit-wise.", "All shops/offices measured on site.", "Occupancy verified with tenants.", "Owner provided allotment papers."];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const chance = (p) => Math.random() < p;
const mobile = () => `${pick([9, 8, 7])}${rint(100000000, 999999999)}`;
const aadhaar = () => `${rint(2000, 9999)} ${rint(1000, 9999)} ${rint(1000, 9999)}`;
const personName = () => `${pick(maleFirst)} ${pick(lastNames)}`;
const address = () => `${rint(1, 200)}, ${pick(mohallas)}, Vikas Nagar, Lucknow, U.P. - 226022`;
const surveyDate = () => { const d = new Date(); d.setDate(d.getDate() - rint(1, 60)); return d.toISOString().slice(0, 10); };
const isRent = (o) => String(o || "").includes("Rent");
const ownerLite = () => ({ owner_name: personName(), father_or_husband_name: personName(), occupation: pick(occupations), mobile: mobile(), aadhar: aadhaar(), disabled_person: false });
const unitUtil = () => ({ electric_connection: true, water_connection: chance(0.9), gas_connection: false, sewer_connection: chance(0.8), internet_connection: chance(0.7), has_kitchen: false, kitchen_count: 0, kitchen_area: 0, has_toilet: true, toilet_count: 1, toilet_area: rint(3, 6), parking_type: "Covered", parking_area: rint(0, 15) });

// Build one complex. `bigOwner` (if given) is assigned to `bigCount` units.
function buildComplex(bigOwner, bigCount) {
    const plot = rint(250, 600);
    const floors = [{ floor_number: -1, floor_use: "Parking", carpet_area: rint(150, 300) }];
    const allUnits = [];
    for (let f = 0; f < 4; f++) {
        const uN = rint(3, 4); const units = [];
        for (let u = 0; u < uN; u++) {
            const occ = pick(["Self", "Rented", "Rented", "Vacant"]);
            const unit = {
                unit_number: `${f === 0 ? "S" : "O" + f}-${u + 1}`, carpet_area: rint(25, 80),
                occupancy_status: occ, rent_amount: occ === "Rented" ? rint(10000, 50000) : null,
                owner: ownerLite(), utilities: unitUtil(),
            };
            units.push(unit); allUnits.push(unit);
        }
        floors.push({ floor_number: f, floor_use: "Unit", number_of_units: uN, carpet_area: units.reduce((s, x) => s + x.carpet_area, 0), units });
    }
    // Hand a repeated owner more than one unit in this complex.
    if (bigOwner) for (let i = 0; i < Math.min(bigCount, allUnits.length); i++) allUnits[i].owner = bigOwner;

    const bua = floors.reduce((s, f) => s + (f.carpet_area || 0), 0);
    return {
        property_type: "NonResidential", property_subtype: "CommercialComplex", plot_area: plot, construction: "RCC",
        address: address(), is_multi_entry: true, owners: [ownerLite()],
        utilities: { electric_connection: true, gas_connection: false, solar_connection: chance(0.2), sewer_connection: chance(0.85), rainwater_harvesting: chance(0.4) },
        roads: [{ road_side: "Front", road_exists: true, road_type: pick(["CC Road", "Bitumen"]), road_width: rint(9, 18), carriageway_area: rint(60, 200), footpath_area: rint(10, 40) }],
        building: { floors_above_ground: 4, floors_below_ground: 1, total_builtup_area: bua, building_occupancy: null, construction_year: rint(2008, 2023), floors },
    };
}

function toTaxInput(plan, id, code) {
    return {
        id, property_code: code, property_type: plan.property_type, property_subtype: plan.property_subtype,
        construction_type: plan.construction, plot_area: plan.plot_area, sewer_connection: !!plan.utilities.sewer_connection,
        Building: {
            total_builtup_area: plan.building.total_builtup_area, building_occupancy: plan.building.building_occupancy,
            Floors: plan.building.floors.map((f) => ({
                floor_number: f.floor_number, floor_use: f.floor_use, carpet_area: f.carpet_area, occupancy_status: null, FloorOccupancy: null,
                Units: (f.units || []).map((u) => ({ unit_number: u.unit_number, carpet_area: u.carpet_area, occupancy_status: u.occupancy_status })),
            })),
        },
    };
}

async function insert(plan, polygonId, featureId, centroid, seq) {
    const code = `LKOCC${String(seq).padStart(3, "0")}`;
    const surveyor = pick(SURVEYORS); const sdate = surveyDate();
    const property = await Property.create({ polygon_id: polygonId, project_id: PROJECT_ID, property_code: code, surveyor_id: surveyor, property_type: plan.property_type, property_subtype: plan.property_subtype, address: plan.address, plot_area: plan.plot_area, construction_type: plan.construction, survey_date: sdate, is_multi_entry: true });
    const survey = await Survey.create({ property_id: property.id, surveyor_id: surveyor, polygon_id: polygonId, project_id: PROJECT_ID, survey_date: sdate, status: "completed", current_step: 7, latitude: centroid.lat, longitude: centroid.lng, remarks: pick(remarks) });
    await property.update({ survey_id: survey.id });
    for (const o of plan.owners) await PropertyOwner.create({ property_id: property.id, ...o });
    await PropertyUtilities.create({ property_id: property.id, ...plan.utilities });
    for (const r of plan.roads) await PropertyRoad.create({ property_id: property.id, ...r });

    const b = await Building.create({ property_id: property.id, floors_above_ground: 4, floors_below_ground: 1, construction_year: plan.building.construction_year, total_builtup_area: plan.building.total_builtup_area, building_occupancy: null });
    for (const f of plan.building.floors) {
        const floor = await Floor.create({ building_id: b.id, floor_number: f.floor_number, carpet_area: f.carpet_area, floor_use: f.floor_use, number_of_units: f.number_of_units || null, construction_year: plan.building.construction_year });
        for (const u of (f.units || [])) {
            const unit = await Unit.create({ floor_id: floor.id, unit_number: u.unit_number, carpet_area: u.carpet_area, occupancy_status: u.occupancy_status, rent_amount: u.rent_amount || null, occupant_name: isRent(u.occupancy_status) ? personName() : null, occupant_mobile: isRent(u.occupancy_status) ? mobile() : null });
            await UnitOwner.create({ unit_id: unit.id, ...u.owner });
            await UnitUtilities.create({ unit_id: unit.id, ...u.utilities });
        }
    }
    await sequelize.query(`UPDATE "AssetFeatures" SET polygon_id = :pid, status = 'PUBLISHED' WHERE id = :fid`, { replacements: { pid: polygonId, fid: featureId } });

    const breakdown = computeTax(toTaxInput(plan, property.id, code));
    await PropertyTaxAssessment.create({ property_id: property.id, polygon_id: polygonId, project_id: PROJECT_ID, assessment_year: breakdown.assessment_year, arv: breakdown.arv_total, total_amount: breakdown.total_annual, breakdown, status: "APPROVED", approved_by: ADMIN, approved_at: new Date() });
    return { code, total: breakdown.total_annual, units: plan.building.floors.reduce((s, f) => s + (f.units ? f.units.length : 0), 0) };
}

(async () => {
    const q = (sql, r) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });
    try {
        const feats = await q(
            `SELECT id, ST_Y(ST_PointOnSurface(geom)) lat, ST_X(ST_PointOnSurface(geom)) lng
             FROM "AssetFeatures" WHERE layer_id = :layer AND project_id = :proj AND polygon_id IS NULL AND is_active = true
             ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) LIMIT :n`,
            { layer: PROPERTY_LAYER, proj: PROJECT_ID, lng: CLUSTER.lng, lat: CLUSTER.lat, n: N_COMPLEXES }
        );
        const polys = await q(
            `SELECT id FROM "Polygons" WHERE is_active = true AND id NOT IN (SELECT polygon_id FROM "AssetFeatures" WHERE polygon_id IS NOT NULL) ORDER BY id LIMIT :n`,
            { n: N_COMPLEXES }
        );
        const n = Math.min(feats.length, polys.length, N_COMPLEXES);
        console.log(`🏬 Building ${n} commercial complexes (4 floors + basement)…`);

        const results = [];
        for (let i = 0; i < n; i++) {
            const bigOwner = i < N_MULTI_OWNER ? ownerLite() : null;
            const bigCount = bigOwner ? rint(2, 3) : 0;
            const plan = buildComplex(bigOwner, bigCount);
            const r = await insert(plan, polys[i].id, feats[i].id, { lat: feats[i].lat, lng: feats[i].lng }, i + 1);
            results.push({ ...r, bigOwner: bigOwner ? bigOwner.owner_name : null, bigCount });
            process.stdout.write(".");
        }

        console.log(`\n\n✅ Seeded ${results.length} commercial complexes.`);
        console.log("\nHouse ID → units → annual tax:");
        results.forEach((r) => console.log(`  ${r.code}  ${r.units} units  ₹${r.total.toLocaleString("en-IN")}${r.bigOwner ? `   ← ${r.bigOwner} owns ${r.bigCount} units` : ""}`));
        console.log(`\nMulti-unit owners: ${results.filter((r) => r.bigOwner).length}`);
        console.log(`House IDs: LKOCC001 … LKOCC${String(results.length).padStart(3, "0")} (try on /tax → Know Your House Tax).`);
    } catch (e) {
        console.error("FATAL", e);
    } finally {
        await sequelize.close();
    }
})();
