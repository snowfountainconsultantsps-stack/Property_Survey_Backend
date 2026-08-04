// ════════════════════════════════════════════════════════════════
// Seed ~50 realistic Indian property surveys across ALL categories on a
// contiguous cluster of real parcels, then compute + approve their tax.
//
//   node scripts/seedProperties.js
//
// Destructive: wipes ALL existing property-survey data first.
// ════════════════════════════════════════════════════════════════
const {
    sequelize, Property, Survey, PropertyOwner, PropertyUtilities, PropertyRoad,
    Building, Floor, FloorUtilities, FloorOccupancy, Unit, UnitOwner, UnitUtilities,
    PropertyTaxAssessment,
} = require("../models");
const { computeTax } = require("../services/taxCalculator");

// Known ids from inspection.
const PROJECT_ID = 2;
const PROPERTY_LAYER = 15;
const ADMIN = "a7089077-3bad-4290-b23c-1f07650caa20";
const SURVEYORS = ["893d6552-986a-4ce6-a707-c7a956a2d307", "334e2a88-902d-4f33-a841-dd322a46dad7"];
const CLUSTER = { lng: 80.94, lat: 26.83 }; // centre of the section to populate

// ── Indian data pools ────────────────────────────────────────────
const maleFirst = ["Ram Prasad", "Suresh", "Rajesh", "Anil", "Vijay", "Manoj", "Sanjay", "Amit", "Deepak", "Ravi", "Sunil", "Ashok", "Dinesh", "Rakesh", "Naresh", "Pramod", "Arun", "Vinod", "Gopal", "Shyam", "Mohan", "Girish", "Yogesh", "Mukesh", "Brijesh", "Satish", "Ramesh", "Om Prakash", "Jagdish", "Kailash"];
const femaleFirst = ["Sunita", "Rekha", "Geeta", "Anita", "Poonam", "Kavita", "Meena", "Pooja", "Neha", "Priya", "Shobha", "Usha", "Kiran", "Sarita", "Anjali", "Nirmala"];
const lastNames = ["Verma", "Sharma", "Gupta", "Yadav", "Singh", "Srivastava", "Tiwari", "Mishra", "Pandey", "Tripathi", "Agarwal", "Shukla", "Dubey", "Chaudhary", "Rastogi", "Saxena", "Bajpai", "Awasthi", "Dixit", "Nigam"];
const occupations = ["Business", "Govt. Service", "Private Service", "Shopkeeper", "Teacher", "Farmer", "Doctor", "Advocate", "Retired", "Self-employed", "Contractor", "Clerk"];
const shopNames = ["Sharma General Store", "Gupta Electronics", "Verma Sweets & Namkeen", "Singh Medical Store", "Yadav Cloth House", "Krishna Provision", "Balaji Hardware", "Annapurna Restaurant", "Maa Ambe Traders", "New Lucknow Garments", "Shri Ram Stationery", "Bansal Mobile Point"];
const fuelBrands = ["IndianOil Petrol Pump", "HP Fuel Station", "Bharat Petroleum Outlet"];
const mohallas = ["Gangaram Purwa", "Shivaji Marg", "Nehru Nagar", "Gandhi Ward", "Indira Colony", "Rajendra Nagar", "Ashok Vihar", "Subhash Marg", "Patel Nagar", "Tilak Road", "Ambedkar Nagar", "Vikas Khand"];
const remarks = ["Survey completed. Owner cooperative.", "Occupant verified on site.", "Measurements taken with tape.", "Verified with property documents.", "Field photographs captured.", "Assessment done as per unit area."];
const constructions = ["RCC", "RCC", "RCC", "Pucca", "Pucca", "Semi-Pucca", "Kutcha", "Tin"];

// ── helpers ──────────────────────────────────────────────────────
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const rand = (lo, hi) => Math.round((Math.random() * (hi - lo) + lo) * 10) / 10;
const chance = (p) => Math.random() < p;
const mobile = () => `${pick([9, 8, 7])}${rint(100000000, 999999999)}`;
const aadhaar = () => `${rint(2000, 9999)} ${rint(1000, 9999)} ${rint(1000, 9999)}`;
const personName = () => `${chance(0.82) ? pick(maleFirst) : pick(femaleFirst)} ${pick(lastNames)}`;
const fatherName = () => `${pick(maleFirst)} ${pick(lastNames)}`;
const address = () => `${rint(1, 400)}/${rint(1, 30)}, ${pick(mohallas)}, Vikas Nagar, Lucknow, U.P. - 226022`;
const surveyDate = () => { const d = new Date(); d.setDate(d.getDate() - rint(1, 60)); return d.toISOString().slice(0, 10); };
const isRent = (o) => String(o || "").includes("Rent");

const owner = () => ({ owner_name: personName(), father_or_husband_name: fatherName(), occupation: pick(occupations), disabled_person: chance(0.04), mobile_number: mobile(), aadhar_number: aadhaar() });
const ownerLite = () => ({ owner_name: personName(), father_or_husband_name: fatherName(), occupation: pick(occupations), mobile: mobile(), aadhar: aadhaar(), disabled_person: false });
const utils = () => ({ electric_connection: true, gas_connection: chance(0.6), solar_connection: chance(0.1), sewer_connection: chance(0.7), rainwater_harvesting: chance(0.2) });
const roads = () => {
    const r = [{ road_side: "Front", road_exists: true, road_type: pick(["CC Road", "Bitumen", "Interlocking", "Kutcha"]), road_width: rand(3, 12), carriageway_area: rint(20, 120), footpath_area: rint(0, 30) }];
    if (chance(0.3)) r.push({ road_side: "Left", road_exists: true, road_type: pick(["CC Road", "Bitumen"]), road_width: rand(2, 6), carriageway_area: rint(10, 60), footpath_area: 0 });
    return r;
};
const resFloorUtil = () => ({ has_kitchen: true, kitchen_count: 1, kitchen_area: rint(6, 15), has_toilet: true, toilet_count: rint(1, 2), toilet_area: rint(3, 8) });
const unitUtil = (commercial) => ({ electric_connection: true, water_connection: chance(0.9), gas_connection: !commercial && chance(0.6), sewer_connection: chance(0.7), internet_connection: chance(0.5), has_kitchen: !commercial, kitchen_count: commercial ? 0 : 1, kitchen_area: commercial ? 0 : rint(6, 12), has_toilet: true, toilet_count: 1, toilet_area: rint(3, 6), parking_type: pick(["None", "Open", "Covered"]), parking_area: rint(0, 20) });
const pickOcc = () => pick(["Self", "Self", "Self", "Rented", "Rented", "SelfRented", "Vacant"]);

// ── category plan builders ───────────────────────────────────────
function buildPlan(cat) {
    const construction = pick(constructions);
    const base = { category: cat, construction, address: address(), owners: [owner(), ...(chance(0.25) ? [owner()] : [])], utilities: utils(), roads: roads() };

    if (cat === "RES_SINGLE") {
        const plot = rint(60, 180); const carpet = Math.round(plot * rand(0.55, 0.75)); const occ = pickOcc();
        return { ...base, property_type: "Residential", property_subtype: "SingleStory", plot_area: plot, is_multi_entry: false,
            building: { floors_above_ground: 1, floors_below_ground: 0, total_builtup_area: carpet, building_occupancy: occ, construction_year: rint(1990, 2022),
                floors: [{ floor_number: 0, carpet_area: carpet, occupancy_status: occ, floorOccupancy: { occupancy_status: occ, carpet_area: carpet }, floorUtilities: resFloorUtil() }] } };
    }
    if (cat === "RES_MULTI") {
        const n = rint(2, 4); const plot = rint(90, 220); const floors = [];
        for (let f = 0; f < n; f++) {
            const uN = rint(1, 2); const units = [];
            for (let u = 0; u < uN; u++) { const ca = rint(45, 110); const occ = pickOcc(); units.push({ unit_number: `${f === 0 ? "G" : "F" + f}-${u + 1}`, carpet_area: ca, occupancy_status: occ, rent_amount: isRent(occ) ? rint(4000, 15000) : null, owner: ownerLite(), utilities: unitUtil(false) }); }
            floors.push({ floor_number: f, floor_use: "Unit", number_of_units: uN, carpet_area: units.reduce((s, x) => s + x.carpet_area, 0), units });
        }
        const bua = floors.reduce((s, f) => s + f.carpet_area, 0);
        return { ...base, property_type: "Residential", property_subtype: "MultiStory", plot_area: plot, is_multi_entry: true,
            building: { floors_above_ground: n, floors_below_ground: 0, total_builtup_area: bua, building_occupancy: null, construction_year: rint(1995, 2023), floors } };
    }
    if (cat === "COMMERCIAL") {
        const plot = rint(30, 120); const carpet = Math.round(plot * rand(0.7, 0.95)); const occ = pick(["Self", "Rented"]);
        return { ...base, property_type: "NonResidential", property_subtype: "Commercial", plot_area: plot, is_multi_entry: false, shop: pick(shopNames),
            building: { floors_above_ground: 1, floors_below_ground: 0, total_builtup_area: carpet, building_occupancy: occ, construction_year: rint(1990, 2021),
                floors: [{ floor_number: 0, carpet_area: carpet, occupancy_status: occ, floorOccupancy: { occupancy_status: occ, carpet_area: carpet } }] } };
    }
    if (cat === "COMPLEX") {
        const n = rint(2, 3); const plot = rint(200, 500); const floors = [{ floor_number: -1, floor_use: "Parking", carpet_area: rint(100, 250) }];
        for (let f = 0; f < n; f++) {
            const uN = rint(2, 4); const units = [];
            for (let u = 0; u < uN; u++) { const ca = rint(25, 80); const occ = pick(["Self", "Rented", "Rented", "Vacant"]); units.push({ unit_number: `${f === 0 ? "S" : "O"}${u + 1}`, carpet_area: ca, occupancy_status: occ, rent_amount: occ === "Rented" ? rint(8000, 45000) : null, owner: ownerLite(), utilities: unitUtil(true) }); }
            floors.push({ floor_number: f, floor_use: "Unit", number_of_units: uN, carpet_area: units.reduce((s, x) => s + x.carpet_area, 0), units });
        }
        const bua = floors.reduce((s, f) => s + (f.carpet_area || 0), 0);
        return { ...base, property_type: "NonResidential", property_subtype: "CommercialComplex", plot_area: plot, is_multi_entry: true, shop: pick(shopNames),
            building: { floors_above_ground: n, floors_below_ground: 1, total_builtup_area: bua, building_occupancy: null, construction_year: rint(2005, 2023), floors } };
    }
    if (cat === "PETROL") {
        const plot = rint(600, 1500); const carpet = rint(40, 90);
        return { ...base, property_type: "NonResidential", property_subtype: "PetrolPump", plot_area: plot, is_multi_entry: false, shop: pick(fuelBrands),
            building: { floors_above_ground: 1, floors_below_ground: 0, total_builtup_area: carpet, building_occupancy: "Self", construction_year: rint(2000, 2020),
                floors: [{ floor_number: 0, carpet_area: carpet, occupancy_status: "Self", floorOccupancy: { occupancy_status: "Self", carpet_area: carpet } }] } };
    }
    if (cat === "MIXED") {
        const plot = rint(80, 200); const g = rint(30, 70); const u1 = rint(40, 90);
        const occG = pick(["Rented", "Self"]); const occU = pick(["Self", "Rented"]);
        return { ...base, property_type: "Mixed", property_subtype: null, plot_area: plot, is_multi_entry: false, shop: pick(shopNames),
            building: { floors_above_ground: 2, floors_below_ground: 0, total_builtup_area: g + u1, building_occupancy: null, construction_year: rint(1995, 2020),
                floors: [
                    { floor_number: 0, carpet_area: g, occupancy_status: occG, floorOccupancy: { occupancy_status: occG, carpet_area: g } },
                    { floor_number: 1, carpet_area: u1, occupancy_status: occU, floorOccupancy: { occupancy_status: occU, carpet_area: u1 }, floorUtilities: resFloorUtil() },
                ] } };
    }
    // VACANT
    const plot = rint(80, 300);
    return { ...base, property_type: "Vacant", property_subtype: null, plot_area: plot, is_multi_entry: false, building: null };
}

// Normalized tree the tax engine expects.
function toTaxInput(plan, id, code) {
    return {
        id, property_code: code, property_type: plan.property_type, property_subtype: plan.property_subtype,
        construction_type: plan.construction, plot_area: plan.plot_area, sewer_connection: !!plan.utilities.sewer_connection,
        Building: plan.building ? {
            total_builtup_area: plan.building.total_builtup_area, building_occupancy: plan.building.building_occupancy,
            Floors: plan.building.floors.map((f) => ({
                floor_number: f.floor_number, floor_use: f.floor_use || null, carpet_area: f.carpet_area,
                occupancy_status: f.occupancy_status || null, FloorOccupancy: f.floorOccupancy || null,
                Units: (f.units || []).map((u) => ({ unit_number: u.unit_number, carpet_area: u.carpet_area, occupancy_status: u.occupancy_status })),
            })),
        } : null,
    };
}

async function insertProperty(plan, polygonId, featureId, centroid, seq) {
    const code = `LKOVN${String(seq).padStart(3, "0")}`;
    const surveyor = pick(SURVEYORS);
    const sdate = surveyDate();

    const property = await Property.create({
        polygon_id: polygonId, project_id: PROJECT_ID, property_code: code, surveyor_id: surveyor,
        property_type: plan.property_type, property_subtype: plan.property_subtype, address: plan.address,
        plot_area: plan.plot_area, construction_type: plan.construction, survey_date: sdate, is_multi_entry: plan.is_multi_entry,
    });
    const survey = await Survey.create({
        property_id: property.id, surveyor_id: surveyor, polygon_id: polygonId, project_id: PROJECT_ID,
        survey_date: sdate, status: "completed", current_step: 7, latitude: centroid.lat, longitude: centroid.lng, remarks: pick(remarks),
    });
    await property.update({ survey_id: survey.id });

    for (const o of plan.owners) await PropertyOwner.create({ property_id: property.id, ...o });
    await PropertyUtilities.create({ property_id: property.id, ...plan.utilities });
    for (const r of plan.roads) await PropertyRoad.create({ property_id: property.id, ...r });

    if (plan.building) {
        const b = await Building.create({ property_id: property.id, floors_above_ground: plan.building.floors_above_ground, floors_below_ground: plan.building.floors_below_ground, construction_year: plan.building.construction_year, total_builtup_area: plan.building.total_builtup_area, building_occupancy: plan.building.building_occupancy });
        for (const f of plan.building.floors) {
            const floor = await Floor.create({ building_id: b.id, floor_number: f.floor_number, carpet_area: f.carpet_area, floor_use: f.floor_use || null, number_of_units: f.number_of_units || null, occupancy_status: f.occupancy_status || null, occupant_name: isRent(f.occupancy_status) ? personName() : null, occupant_mobile: isRent(f.occupancy_status) ? mobile() : null, construction_year: plan.building.construction_year });
            if (f.floorUtilities) await FloorUtilities.create({ floor_id: floor.id, ...f.floorUtilities });
            if (f.floorOccupancy) await FloorOccupancy.create({ floor_id: floor.id, ...f.floorOccupancy, occupant_name: isRent(f.floorOccupancy.occupancy_status) ? personName() : null, occupant_mobile: isRent(f.floorOccupancy.occupancy_status) ? mobile() : null, rent_amount: isRent(f.floorOccupancy.occupancy_status) ? rint(5000, 25000) : null });
            for (const u of (f.units || [])) {
                const unit = await Unit.create({ floor_id: floor.id, unit_number: u.unit_number, carpet_area: u.carpet_area, occupancy_status: u.occupancy_status, rent_amount: u.rent_amount || null, occupant_name: isRent(u.occupancy_status) ? personName() : null, occupant_mobile: isRent(u.occupancy_status) ? mobile() : null });
                if (u.owner) await UnitOwner.create({ unit_id: unit.id, ...u.owner });
                if (u.utilities) await UnitUtilities.create({ unit_id: unit.id, ...u.utilities });
            }
        }
    }

    // Link the real parcel feature so the admin map colours it green.
    await sequelize.query(
        `UPDATE "AssetFeatures" SET polygon_id = :pid, status = 'PUBLISHED' WHERE id = :fid`,
        { replacements: { pid: polygonId, fid: featureId } }
    );

    // Compute + approve tax so it's visible to admin and citizen immediately.
    const breakdown = computeTax(toTaxInput(plan, property.id, code));
    await PropertyTaxAssessment.create({
        property_id: property.id, polygon_id: polygonId, project_id: PROJECT_ID,
        assessment_year: breakdown.assessment_year, arv: breakdown.arv_total, total_amount: breakdown.total_annual,
        breakdown, status: "APPROVED", approved_by: ADMIN, approved_at: new Date(),
    });

    return { code, category: plan.category, type: `${plan.property_type}${plan.property_subtype ? "/" + plan.property_subtype : ""}`, total: breakdown.total_annual };
}

(async () => {
    const q = (sql, r) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });
    try {
        console.log("⏳ Deleting existing property-survey data…");
        // Child → parent order.
        for (const tbl of ['UnitPhotos', 'UnitUtilities', 'UnitOwners', 'Units', 'FloorOccupancies', 'FloorUtilities', 'Floors', 'Buildings', 'PropertyPhotos', 'PropertyRoads', 'PropertyUtilities', 'PropertyOwners', 'PropertyTaxAssessments', 'Surveys', 'Properties']) {
            await sequelize.query(`DELETE FROM "${tbl}"`);
        }
        // Unlink any parcels that pointed at the old properties.
        await sequelize.query(`UPDATE "AssetFeatures" SET polygon_id = NULL WHERE layer_id = ${PROPERTY_LAYER} AND polygon_id IS NOT NULL`);
        console.log("✅ Cleared.");

        // 50 contiguous parcels near the cluster centre.
        const feats = await q(
            `SELECT id, ST_Y(ST_PointOnSurface(geom)) lat, ST_X(ST_PointOnSurface(geom)) lng
             FROM "AssetFeatures"
             WHERE layer_id = :layer AND project_id = :proj AND polygon_id IS NULL AND is_active = true
             ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
             LIMIT 50`,
            { layer: PROPERTY_LAYER, proj: PROJECT_ID, lng: CLUSTER.lng, lat: CLUSTER.lat }
        );
        // 50 free polygon ids to use as the link keys.
        const polys = await q(
            `SELECT id FROM "Polygons"
             WHERE is_active = true AND id NOT IN (SELECT polygon_id FROM "AssetFeatures" WHERE polygon_id IS NOT NULL)
             ORDER BY id LIMIT 50`
        );
        const nUse = Math.min(feats.length, polys.length, 50);
        console.log(`🏗️  Building ${nUse} properties on real parcels…`);

        // Category schedule (covers every type), shuffled for spatial mix.
        const schedule = [
            ...Array(18).fill("RES_SINGLE"), ...Array(12).fill("RES_MULTI"),
            ...Array(6).fill("COMMERCIAL"), ...Array(4).fill("COMPLEX"),
            ...Array(2).fill("PETROL"), ...Array(5).fill("MIXED"), ...Array(3).fill("VACANT"),
        ].sort(() => Math.random() - 0.5).slice(0, nUse);

        const results = [];
        for (let i = 0; i < nUse; i++) {
            try {
                const plan = buildPlan(schedule[i]);
                const r = await insertProperty(plan, polys[i].id, feats[i].id, { lat: feats[i].lat, lng: feats[i].lng }, i + 1);
                results.push(r);
                process.stdout.write(".");
            } catch (e) {
                console.log(`\n⚠️  #${i + 1} (${schedule[i]}) failed: ${e.message}`);
            }
        }

        console.log(`\n\n✅ Seeded ${results.length} properties.`);
        const byCat = {};
        results.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + 1));
        console.log("By category:", JSON.stringify(byCat));
        console.log("\nSample (House ID → type → annual tax):");
        results.slice(0, 12).forEach((r) => console.log(`  ${r.code}  ${r.type.padEnd(28)}  ₹${r.total.toLocaleString("en-IN")}`));
        console.log(`\nHouse IDs: LKOVN001 … LKOVN${String(results.length).padStart(3, "0")} (try these on /tax → Know Your House Tax).`);
    } catch (e) {
        console.error("FATAL", e);
    } finally {
        await sequelize.close();
    }
})();
