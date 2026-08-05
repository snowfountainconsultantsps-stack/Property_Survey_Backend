// ════════════════════════════════════════════════════════════════
// Property-tax engine — ARV (Annual Rental Value), unit-area method.
//
// The tax is derived transparently from the survey's own categorization:
//   Property (type / subtype / construction / plot area)
//     └─ Building
//          └─ Floors (carpet area, use, occupancy)
//               └─ Units (carpet area, occupancy)   ← multi-storey / complex
//
// For every taxable space:
//   MRV (monthly)  = area(m²) × base_rate × construction_factor × occupancy_factor
//   ARV (annual)   = MRV × 12
// Tax heads are then a fraction of the total ARV.
//
// ⚠️  The numbers in TAX_CONFIG are TRANSPARENT DEFAULTS, not official notified
//     rates. Adjust them to your ULB's rate schedule — every value is echoed
//     back in the breakdown so the calculation is fully auditable.
// ════════════════════════════════════════════════════════════════

const ASSESSMENT_YEAR = "2025-26";

const TAX_CONFIG = {
  // Monthly rateable value per square metre, by how the space is used.
  monthly_rate_per_sqm: {
    RESIDENTIAL: 20,
    COMMERCIAL: 60,
    PARKING: 8,
    VACANT_LAND: 5,
    // Open/covered commercial areas that aren't enclosed floor space. A fuel
    // station's value sits in its forecourt and canopy, not its small office,
    // so these are rated separately from COMMERCIAL floor area.
    CANOPY: 25,
    FORECOURT: 6,
  },
  // Construction-quality multiplier (matched case-insensitively).
  construction_factor: {
    rcc: 1.0, pucca: 1.0, "semi-pucca": 0.8, "semi pucca": 0.8,
    kutcha: 0.5, tin: 0.6, shed: 0.6, default: 1.0,
  },
  // Occupancy multiplier — rented space is rated higher (ARV method).
  occupancy_factor: {
    Self: 1.0, SelfRented: 1.25, Rented: 1.5, Vacant: 0.5, default: 1.0,
  },
  // Tax heads, each a fraction of the total ARV.
  heads: [
    { key: "house_tax", label: "House Tax", rate: 0.125, requires: null },
    { key: "water_tax", label: "Water Tax", rate: 0.075, requires: null },
    { key: "sewerage_tax", label: "Sewerage Tax", rate: 0.05, requires: "sewer" },
    { key: "conservancy_tax", label: "Conservancy / Sanitation", rate: 0.05, requires: null },
    { key: "education_cess", label: "Education Cess", rate: 0.02, requires: null },
  ],
  // Rebate on the total, for wholly self-occupied residential property.
  self_occupied_rebate: 0.10,
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v) => Math.round(num(v) * 100) / 100;

function constructionFactor(type) {
  if (!type) return TAX_CONFIG.construction_factor.default;
  const key = String(type).trim().toLowerCase();
  return TAX_CONFIG.construction_factor[key] ?? TAX_CONFIG.construction_factor.default;
}
function occupancyFactor(status) {
  return TAX_CONFIG.occupancy_factor[status] ?? TAX_CONFIG.occupancy_factor.default;
}

// Residential vs commercial for a given floor. Mixed-use puts shops on the
// ground/basement and homes above — a documented assumption, not a rule.
function usageFor(propertyType, floorNumber) {
  if (propertyType === "NonResidential") return "COMMERCIAL";
  if (propertyType === "Mixed") return num(floorNumber) <= 0 ? "COMMERCIAL" : "RESIDENTIAL";
  return "RESIDENTIAL";
}

function floorLabel(n) {
  n = num(n);
  if (n === 0) return "Ground Floor";
  if (n < 0) return `Basement ${Math.abs(n)}`;
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]} Floor`;
}

// ── Spaces that come from the type-specific questionnaire ────────
// Answers to PropertyTypeConfig.attribute_schema, stored on
// Properties.type_specific_attributes. Only areas the floor/unit walk cannot
// already see are added here, so nothing is counted twice: a complex's
// basement parking, for instance, is already a Parking floor and is
// deliberately NOT re-added from `basement_parking_area_sqm`.
function deriveAttributeSpaces(property) {
  const a = property.type_specific_attributes;
  if (!a || typeof a !== "object") return [];

  const construction = property.construction_type || null;
  const spaces = [];
  const add = (label, usage, area) => {
    if (num(area) > 0) {
      spaces.push({
        label, usage, area_sqm: num(area),
        occupancy: "Self", construction_type: construction, from_attributes: true,
      });
    }
  };

  const subtype = property.property_subtype;

  if (subtype === "PetrolPump") {
    // Without these a fuel station is rated only on its office cabin, which
    // understates it by an order of magnitude.
    add("Canopy (fuel dispensing)", "CANOPY", a.canopy_area_sqm);
    add("Paved forecourt", "FORECOURT", a.forecourt_area_sqm);
    if (a.has_convenience_store) add("Convenience store", "COMMERCIAL", a.store_area_sqm);
    if (a.has_service_station) add("Service / washing bay", "COMMERCIAL", a.service_bay_area_sqm);
  }

  if (subtype === "Commercial" && a.has_mezzanine) {
    add("Mezzanine", "COMMERCIAL", a.mezzanine_area_sqm);
  }

  if (property.property_type === "Vacant" && a.has_temporary_structure) {
    add("Temporary structure", "COMMERCIAL", a.temporary_structure_area_sqm);
  }

  return spaces;
}

// Owners recorded against a unit. A single unit is often held jointly
// (spouses, brothers) — that is ONE liability with several names on it, not
// several bills, so joint owners are kept together as one group.
function ownersOf(unit) {
  const list = unit.UnitOwners || unit.unit_owners || [];
  return list
    .filter((o) => o && (o.owner_name || o.mobile))
    .map((o) => ({
      owner_name: o.owner_name || "Unnamed",
      mobile: o.mobile || null,
      father_or_husband_name: o.father_or_husband_name || null,
    }));
}

// ── Derive the list of taxable spaces from the property tree ──────
function deriveSpaces(property) {
  const spaces = [];
  const construction = property.construction_type || null;
  const building = property.Building;
  const isMultiEntry = ["MultiStory", "CommercialComplex"].includes(property.property_subtype);

  // Vacant land (or a plot with no building captured) → land tax only.
  if (property.property_type === "Vacant" || !building) {
    const area = num(property.plot_area);
    if (area > 0) {
      spaces.push({
        label: "Vacant plot", usage: "VACANT_LAND", area_sqm: area,
        occupancy: "Vacant", construction_type: construction,
      });
    }
    return spaces;
  }

  const floors = building.Floors || [];

  // Building with no floor detail — assess the whole built-up area as one space.
  if (!floors.length) {
    const area = num(building.total_builtup_area);
    if (area > 0) {
      spaces.push({
        label: "Building", usage: usageFor(property.property_type, 0), area_sqm: area,
        occupancy: building.building_occupancy || "Self", construction_type: construction,
      });
    }
    return spaces;
  }

  for (const f of floors) {
    const fno = f.floor_number;
    // Parking floor → low parking rate.
    if (f.floor_use === "Parking") {
      const area = num(f.carpet_area);
      if (area > 0) {
        spaces.push({
          label: `${floorLabel(fno)} · Parking`, usage: "PARKING", area_sqm: area,
          occupancy: "Self", construction_type: construction,
        });
      }
      continue;
    }

    const units = f.Units || [];
    if (isMultiEntry && units.length) {
      for (const u of units) {
        const area = num(u.carpet_area);
        if (area <= 0) continue;
        spaces.push({
          label: `${floorLabel(fno)} · Unit ${u.unit_number || u.id}`,
          usage: usageFor(property.property_type, fno), area_sqm: area,
          occupancy: u.occupancy_status || "Self", construction_type: construction,
          // Carried through so the bill can be split per owner: in a flat or
          // complex each unit is separately owned and separately liable.
          unit_id: u.id ?? null,
          unit_number: u.unit_number || null,
          owners: ownersOf(u),
        });
      }
      continue;
    }

    // Single-entry floor: occupancy at floor / floor-occupancy / building level.
    const occ = f.FloorOccupancy || {};
    const area = num(f.carpet_area) || num(occ.carpet_area);
    if (area <= 0) continue;
    spaces.push({
      label: floorLabel(fno),
      usage: usageFor(property.property_type, fno), area_sqm: area,
      occupancy: f.occupancy_status || occ.occupancy_status || building.building_occupancy || "Self",
      construction_type: construction,
    });
  }
  return spaces;
}

// ── Split the bill by owner ───────────────────────────────────────
// In a multi-storey building or commercial complex each unit is separately
// owned, so a single building-wide figure is not a usable demand. Tax is
// apportioned by each owner's share of the total ARV — exact, because every
// head is itself a flat percentage of ARV, so proportional split and
// per-owner recomputation give the same answer.
//
// Spaces with no unit owner (parking floors, common areas, a petrol pump's
// canopy) are collected under "Building / common" rather than being silently
// spread across owners.
function ownerBreakdown(spaces, arvTotal, totalAnnual) {
  const unitSpaces = spaces.filter((s) => s.unit_id != null);
  if (!unitSpaces.length) return { owner_breakdown: null };

  const groups = new Map();
  const keyFor = (owners) =>
    owners.length
      ? owners.map((o) => `${o.owner_name}|${o.mobile || ""}`).sort().join(" + ")
      : "__unassigned__";

  for (const s of spaces) {
    const owners = s.owners || [];
    const isUnit = s.unit_id != null;
    const key = isUnit ? keyFor(owners) : "__common__";
    if (!groups.has(key)) {
      groups.set(key, {
        owners: isUnit ? owners : [],
        is_common: !isUnit,
        is_joint: isUnit && owners.length > 1,
        unassigned: isUnit && owners.length === 0,
        spaces: [],
        arv: 0,
      });
    }
    const g = groups.get(key);
    g.spaces.push({
      label: s.label, unit_number: s.unit_number || null, usage: s.usage,
      area_sqm: s.area_sqm, occupancy: s.occupancy, arv: s.arv,
    });
    g.arv = round(g.arv + s.arv);
  }

  const out = [...groups.values()].map((g) => {
    const share = arvTotal > 0 ? g.arv / arvTotal : 0;
    return {
      label: g.is_common
        ? "Building / common areas"
        : g.unassigned
          ? "Owner not recorded"
          : g.owners.map((o) => o.owner_name).join(" & "),
      owners: g.owners,
      is_common: g.is_common,
      is_joint: g.is_joint,
      unassigned: g.unassigned,
      unit_count: g.spaces.filter((s) => s.unit_number !== null).length,
      spaces: g.spaces,
      arv: g.arv,
      share_pct: Math.round(share * 1000) / 10,
      tax: round(totalAnnual * share),
    };
  });

  // Biggest liability first; common areas last so owners read as a list.
  out.sort((a, b) => (a.is_common ? 1 : b.is_common ? -1 : b.tax - a.tax));
  return { owner_breakdown: out };
}

// ── Public: compute a full, auditable breakdown for one property ──
function computeTax(property) {
  const spaces = [...deriveSpaces(property), ...deriveAttributeSpaces(property)].map((s) => {
    const base = TAX_CONFIG.monthly_rate_per_sqm[s.usage] || 0;
    const cf = s.usage === "VACANT_LAND" ? 1 : constructionFactor(s.construction_type);
    const of = s.usage === "PARKING" || s.usage === "VACANT_LAND" ? 1 : occupancyFactor(s.occupancy);
    const mrv_monthly = round(s.area_sqm * base * cf * of);
    const arv = round(mrv_monthly * 12);
    return { ...s, base_rate: base, construction_factor: cf, occupancy_factor: of, mrv_monthly, arv };
  });

  const arv_total = round(spaces.reduce((sum, s) => sum + s.arv, 0));
  const hasSewer = !!property.sewer_connection;

  const heads = TAX_CONFIG.heads.map((h) => {
    const applicable = !h.requires || (h.requires === "sewer" && hasSewer);
    return {
      key: h.key, label: h.label, rate: h.rate, basis: "ARV",
      applicable, amount: applicable ? round(arv_total * h.rate) : 0,
    };
  });

  const subtotal = round(heads.reduce((sum, h) => sum + h.amount, 0));

  // Self-occupied rebate only for wholly self-occupied residential property.
  const whollySelf =
    property.property_type === "Residential" &&
    spaces.length > 0 &&
    spaces.every((s) => ["Self", "Vacant"].includes(s.occupancy));
  const rebate = {
    rate: TAX_CONFIG.self_occupied_rebate,
    amount: whollySelf ? round(subtotal * TAX_CONFIG.self_occupied_rebate) : 0,
    reason: whollySelf ? "Wholly self-occupied residential" : null,
  };

  const total_annual = round(subtotal - rebate.amount);

  return {
    ...ownerBreakdown(spaces, arv_total, total_annual),
    assessment_year: ASSESSMENT_YEAR,
    method: "ARV (Annual Rental Value) — unit area",
    property: {
      id: property.id,
      property_code: property.property_code || null,
      property_type: property.property_type || null,
      property_subtype: property.property_subtype || null,
      construction_type: property.construction_type || null,
      sewer_connection: hasSewer,
    },
    spaces,
    arv_total,
    heads,
    subtotal,
    rebate,
    total_annual,
    config: TAX_CONFIG,
    notes: [
      "MRV = area(m²) × base rate × construction factor × occupancy factor; ARV = MRV × 12.",
      "Mixed-use assumes commercial on ground/basement and residential above.",
      "Rates shown are configurable defaults — replace with your ULB's notified schedule.",
    ],
  };
}

module.exports = { computeTax, TAX_CONFIG, ASSESSMENT_YEAR };
