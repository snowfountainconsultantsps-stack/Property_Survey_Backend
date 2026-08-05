const { Sequelize, DataTypes } = require("sequelize");
require("dotenv").config();

// ──────────────────────────────────────────────────────────────
// Sequelize Connection (Supabase PostgreSQL)
// ──────────────────────────────────────────────────────────────
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: "postgres",
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false,
            },
        },
        logging: false,
    }
);

// ──────────────────────────────────────────────────────────────
// Import Models — Location Hierarchy
// ──────────────────────────────────────────────────────────────
const State = require("./state")(sequelize, DataTypes);
const District = require("./district")(sequelize, DataTypes);
const City = require("./city")(sequelize, DataTypes);
const Zone = require("./zone")(sequelize, DataTypes);
const Ulb = require("./ulb")(sequelize, DataTypes);
const Ward = require("./ward")(sequelize, DataTypes);
const Locality = require("./locality")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Project (top-level container)
// ──────────────────────────────────────────────────────────────
const Project = require("./project")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Survey & Surveyor
// ──────────────────────────────────────────────────────────────
const User = require("./user")(sequelize, DataTypes);
const Survey = require("./survey")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Property & Related
// ──────────────────────────────────────────────────────────────
const Polygon = require("./polygon")(sequelize, DataTypes);
const Property = require("./property")(sequelize, DataTypes);
const PropertyOwner = require("./propertyOwner")(sequelize, DataTypes);
const PropertyUtilities = require("./propertyUtilities")(sequelize, DataTypes);
const PropertyRoad = require("./propertyRoad")(sequelize, DataTypes);
const PropertyPhoto = require("./propertyPhoto")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Building & Floor
// ──────────────────────────────────────────────────────────────
const Building = require("./building")(sequelize, DataTypes);
const Floor = require("./floor")(sequelize, DataTypes);
const FloorUtilities = require("./floorUtilities")(sequelize, DataTypes);
const FloorOccupancy = require("./floorOccupancy")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Unit
// ──────────────────────────────────────────────────────────────
const Unit = require("./unit")(sequelize, DataTypes);
const UnitOwner = require("./unitOwner")(sequelize, DataTypes);
const UnitUtilities = require("./unitUtilities")(sequelize, DataTypes);
const UnitPhoto = require("./unitPhoto")(sequelize, DataTypes);

// Tax assessment (computed from the survey; approved by an admin).
const PropertyTaxAssessment = require("./propertyTaxAssessment")(sequelize, DataTypes);

// Per-category survey shape + question schema (drives the wizard).
const PropertyTypeConfig = require("./propertyTypeConfig")(sequelize, DataTypes);

// ──────────────────────────────────────────────────────────────
// Import Models — Digital Assets (drain / sewer / water / roads / etc.)
// Generic layered GIS: Category → Layer → Feature, with an import batch
// (Upload) and a field-survey/correction log (Survey) + photos.
// ──────────────────────────────────────────────────────────────
const AssetCategory = require("./assetCategory")(sequelize, DataTypes);
const AssetLayer = require("./assetLayer")(sequelize, DataTypes);
const AssetFeature = require("./assetFeature")(sequelize, DataTypes);
const AssetUpload = require("./assetUpload")(sequelize, DataTypes);
const AssetSurvey = require("./assetSurvey")(sequelize, DataTypes);
const AssetPhoto = require("./assetPhoto")(sequelize, DataTypes);

// ══════════════════════════════════════════════════════════════
// ASSOCIATIONS
// ══════════════════════════════════════════════════════════════

// ─── Location Hierarchy ────────────────────────────────────────
//   State → District → ULB → [Zone] → Ward → Locality → (Polygon)
//
// The ULB (not the City) is the operational parent: it is the authority that
// defines wards and levies the tax. City remains as an optional geographic
// label hanging off the ULB — see models/ulb.js.
State.hasMany(District, { foreignKey: "state_id" });
District.belongsTo(State, { foreignKey: "state_id" });

District.hasMany(City, { foreignKey: "district_id" });
City.belongsTo(District, { foreignKey: "district_id" });

// ULBs belong to a District; the City link is descriptive only.
District.hasMany(Ulb, { foreignKey: "district_id" });
Ulb.belongsTo(District, { foreignKey: "district_id" });

City.hasMany(Ulb, { foreignKey: "city_id" });
Ulb.belongsTo(City, { foreignKey: "city_id" });

// Zones divide a ULB (large corporations only — optional tier).
Ulb.hasMany(Zone, { foreignKey: "ulb_id" });
Zone.belongsTo(Ulb, { foreignKey: "ulb_id" });

// Wards belong to the ULB directly; zone is an optional grouping.
Ulb.hasMany(Ward, { foreignKey: "ulb_id" });
Ward.belongsTo(Ulb, { foreignKey: "ulb_id" });

Zone.hasMany(Ward, { foreignKey: "zone_id" });
Ward.belongsTo(Zone, { foreignKey: "zone_id" });

// Legacy City→Ward shortcut, retained for historic rows.
City.hasMany(Ward, { foreignKey: "city_id" });
Ward.belongsTo(City, { foreignKey: "city_id" });

// Localities sit inside a ward (non-statutory, optional).
Ward.hasMany(Locality, { foreignKey: "ward_id" });
Locality.belongsTo(Ward, { foreignKey: "ward_id" });

Ward.hasMany(Polygon, { foreignKey: "ward_id" });
Polygon.belongsTo(Ward, { foreignKey: "ward_id" });

// ─── Polygon → Property (One-to-Many) ───────────────────────
Polygon.hasMany(Property, { foreignKey: "polygon_id" });
Property.belongsTo(Polygon, { foreignKey: "polygon_id" });

// ─── User → Property (One-to-Many) ──────────────────────
User.hasMany(Property, { foreignKey: "surveyor_id" });
Property.belongsTo(User, { foreignKey: "surveyor_id" });

// ─── Survey Associations ────────────────────────────────────
Property.hasMany(Survey, { foreignKey: "property_id" });
Survey.belongsTo(Property, { foreignKey: "property_id" });

// One tax assessment per property.
Property.hasOne(PropertyTaxAssessment, { foreignKey: "property_id" });
PropertyTaxAssessment.belongsTo(Property, { foreignKey: "property_id" });

User.hasMany(Survey, { foreignKey: "surveyor_id" });
Survey.belongsTo(User, { foreignKey: "surveyor_id" });

Polygon.hasMany(Survey, { foreignKey: "polygon_id" });
Survey.belongsTo(Polygon, { foreignKey: "polygon_id" });

// ─── Property → PropertyOwner (One-to-Many) ─────────────────
// Used for SingleStory, Commercial, PetrolPump, Mixed
// For MultiStory / CommercialComplex → owners at Unit level
Property.hasMany(PropertyOwner, { foreignKey: "property_id" });
PropertyOwner.belongsTo(Property, { foreignKey: "property_id" });

// ─── Property → PropertyUtilities (One-to-One) ──────────────
// Used for SingleStory, Commercial, PetrolPump, Mixed
Property.hasOne(PropertyUtilities, { foreignKey: "property_id" });
PropertyUtilities.belongsTo(Property, { foreignKey: "property_id" });

// ─── Property → PropertyRoad (One-to-Many, up to 4 sides) ───
Property.hasMany(PropertyRoad, { foreignKey: "property_id" });
PropertyRoad.belongsTo(Property, { foreignKey: "property_id" });

// ─── Property → PropertyPhoto (One-to-Many) ─────────────────
Property.hasMany(PropertyPhoto, { foreignKey: "property_id" });
PropertyPhoto.belongsTo(Property, { foreignKey: "property_id" });

// ─── Property → Building (One-to-One) ───────────────────────
Property.hasOne(Building, { foreignKey: "property_id" });
Building.belongsTo(Property, { foreignKey: "property_id" });

// ─── Building → Floor (One-to-Many) ─────────────────────────
Building.hasMany(Floor, { foreignKey: "building_id" });
Floor.belongsTo(Building, { foreignKey: "building_id" });

// ─── Floor → FloorUtilities (One-to-One) ────────────────────
// Kitchen, toilet, parking at floor level (for single-entry types)
Floor.hasOne(FloorUtilities, { foreignKey: "floor_id" });
FloorUtilities.belongsTo(Floor, { foreignKey: "floor_id" });

// ─── Floor → FloorOccupancy (One-to-One) ────────────────────
// Detailed occupancy for single-entry type floors
Floor.hasOne(FloorOccupancy, { foreignKey: "floor_id" });
FloorOccupancy.belongsTo(Floor, { foreignKey: "floor_id" });

// ─── Floor → Unit (One-to-Many) ─────────────────────────────
// Used for MultiStory & CommercialComplex when floor_use = Unit/Both
Floor.hasMany(Unit, { foreignKey: "floor_id" });
Unit.belongsTo(Floor, { foreignKey: "floor_id" });

// ─── Unit → UnitOwner (One-to-Many) ─────────────────────────
// Owner details at unit level for MultiStory / CommercialComplex
Unit.hasMany(UnitOwner, { foreignKey: "unit_id" });
UnitOwner.belongsTo(Unit, { foreignKey: "unit_id" });

// ─── Unit → UnitUtilities (One-to-One) ──────────────────────
// Utilities + kitchen/toilet/parking at unit level
Unit.hasOne(UnitUtilities, { foreignKey: "unit_id" });
UnitUtilities.belongsTo(Unit, { foreignKey: "unit_id" });

// ─── Unit → UnitPhoto (One-to-Many) ─────────────────────────
Unit.hasMany(UnitPhoto, { foreignKey: "unit_id" });
UnitPhoto.belongsTo(Unit, { foreignKey: "unit_id" });

// ══════════════════════════════════════════════════════════════
// DIGITAL ASSET ASSOCIATIONS
// ══════════════════════════════════════════════════════════════

// ─── Project → everything it scopes ─────────────────────────
Project.hasMany(AssetFeature, { foreignKey: "project_id" });
AssetFeature.belongsTo(Project, { foreignKey: "project_id" });

Project.hasMany(AssetUpload, { foreignKey: "project_id" });
AssetUpload.belongsTo(Project, { foreignKey: "project_id" });

Project.hasMany(Polygon, { foreignKey: "project_id" });
Polygon.belongsTo(Project, { foreignKey: "project_id" });

Project.hasMany(Property, { foreignKey: "project_id" });
Property.belongsTo(Project, { foreignKey: "project_id" });

Project.hasMany(Survey, { foreignKey: "project_id" });
Survey.belongsTo(Project, { foreignKey: "project_id" });

// ─── Category → Layer (One-to-Many) ─────────────────────────
AssetCategory.hasMany(AssetLayer, { foreignKey: "category_id", as: "layers" });
AssetLayer.belongsTo(AssetCategory, { foreignKey: "category_id", as: "category" });

// ─── Layer → Feature (One-to-Many) ──────────────────────────
AssetLayer.hasMany(AssetFeature, { foreignKey: "layer_id", as: "features" });
AssetFeature.belongsTo(AssetLayer, { foreignKey: "layer_id", as: "layer" });

// ─── Layer → Upload batch (One-to-Many) ─────────────────────
AssetLayer.hasMany(AssetUpload, { foreignKey: "layer_id", as: "uploads" });
AssetUpload.belongsTo(AssetLayer, { foreignKey: "layer_id", as: "layer" });

// ─── Upload batch → Feature (One-to-Many) ───────────────────
AssetUpload.hasMany(AssetFeature, { foreignKey: "upload_id", as: "features" });
AssetFeature.belongsTo(AssetUpload, { foreignKey: "upload_id", as: "upload" });

// ─── Ward → Feature (optional area scoping) ─────────────────
Ward.hasMany(AssetFeature, { foreignKey: "ward_id" });
AssetFeature.belongsTo(Ward, { foreignKey: "ward_id" });

// ─── Feature → Survey (One-to-Many) ─────────────────────────
AssetFeature.hasMany(AssetSurvey, { foreignKey: "feature_id", as: "surveys" });
AssetSurvey.belongsTo(AssetFeature, { foreignKey: "feature_id", as: "feature" });

// ─── Feature → Photo (One-to-Many) ──────────────────────────
AssetFeature.hasMany(AssetPhoto, { foreignKey: "feature_id", as: "photos" });
AssetPhoto.belongsTo(AssetFeature, { foreignKey: "feature_id", as: "feature" });

// ─── Survey → Photo (One-to-Many) ───────────────────────────
AssetSurvey.hasMany(AssetPhoto, { foreignKey: "asset_survey_id", as: "photos" });
AssetPhoto.belongsTo(AssetSurvey, { foreignKey: "asset_survey_id", as: "survey" });

// ──────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────
module.exports = {
    sequelize,
    Sequelize,
    // Project
    Project,
    // Location
    State,
    District,
    City,
    Zone,
    Ulb,
    Ward,
    Locality,
    // Survey
    User,
    Survey,
    // Property
    Polygon,
    Property,
    PropertyOwner,
    PropertyUtilities,
    PropertyRoad,
    PropertyPhoto,
    // Building & Floor
    Building,
    Floor,
    FloorUtilities,
    FloorOccupancy,
    // Unit
    Unit,
    UnitOwner,
    UnitUtilities,
    UnitPhoto,
    // Tax
    PropertyTaxAssessment,
    // Survey configuration
    PropertyTypeConfig,
    // Digital Assets
    AssetCategory,
    AssetLayer,
    AssetFeature,
    AssetUpload,
    AssetSurvey,
    AssetPhoto,
};
