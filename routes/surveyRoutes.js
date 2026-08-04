const express = require("express");
const { auth } = require("../middleware/auth");
const upload = require("../config/uploadCloud");
const {
    createPolygon,
    getPolygons,
    getPolygonById,
    createPropertyOwner,
    getPropertyOwners,
    updatePropertyOwner,
    deletePropertyOwner,
    upsertPropertyUtilities,
    getPropertyUtilities,
    createPropertyRoad,
    getPropertyRoads,
    updatePropertyRoad,
    deletePropertyRoad,
    createPropertyPhoto,
    getPropertyPhotos,
    deletePropertyPhoto,
    createBuilding,
    getBuildingByProperty,
    updateBuilding,
    deleteBuilding,
    createFloor,
    getFloorsByBuilding,
    getFloorById,
    updateFloor,
    deleteFloor,
    upsertFloorUtilities,
    getFloorUtilities,
    createFloorOccupancy,
    getFloorOccupancy,
    updateFloorOccupancy,
    deleteFloorOccupancy,
    createUnit,
    getUnitsByFloor,
    getUnitById,
    updateUnit,
    deleteUnit,
    createUnitOwner,
    getUnitOwners,
    updateUnitOwner,
    deleteUnitOwner,
    upsertUnitUtilities,
    getUnitUtilities,
    createUnitPhoto,
    getUnitPhotos,
    updateUnitPhoto,
    deleteUnitPhoto,
    getStates,
    getDistricts,
    getCities,
    getZones,
    getWards,
    createSurveyRecord,
    getSurveyRecords,
    getMySurveys,
    getSurveyRecordById,
    updateSurveyRecord,
    getSurveysByPolygon,
    getSurveysByPolygonCode,
    getPropertiesByPolygon,
    getEnums,
} = require("../controllers/surveyController");

const router = express.Router();

// ═════════════════════════════════════════════════════════════
// ENUMS (no auth — frontend needs this for dropdowns)
// ═════════════════════════════════════════════════════════════
router.get("/enums", getEnums);

// ═════════════════════════════════════════════════════════════
// LOCATION HIERARCHY ROUTES
// ═════════════════════════════════════════════════════════════
// GET /api/surveys/states
// GET /api/surveys/districts?state_id=1
// GET /api/surveys/cities?district_id=1
// GET /api/surveys/zones?city_id=1
// GET /api/surveys/wards?zone_id=1  (or ?city_id=1 for a whole city)
router.get("/states", getStates);
router.get("/districts", getDistricts);
router.get("/cities", getCities);
router.get("/zones", getZones);
router.get("/wards", getWards);

// ═════════════════════════════════════════════════════════════
// SURVEY RECORD ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/records", auth, createSurveyRecord);
router.get("/records", auth, getSurveyRecords);
router.get("/records/my", auth, getMySurveys);
router.get("/records/:id", auth, getSurveyRecordById);
router.put("/records/:id", auth, updateSurveyRecord);

// ═════════════════════════════════════════════════════════════
// POLYGON ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/polygons", auth, createPolygon);
router.get("/polygons", getPolygons);
router.get("/polygons/:id", getPolygonById);
router.get("/polygons/:polygonId/properties", getPropertiesByPolygon);
router.get("/polygon/:polygonId", getSurveysByPolygon);
router.get("/polygon/code/:polygonCode", getSurveysByPolygonCode);

// ═════════════════════════════════════════════════════════════
// PROPERTY OWNER ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/properties/:propertyId/owners", auth, createPropertyOwner);
router.get("/properties/:propertyId/owners", getPropertyOwners);
router.put("/property-owners/:id", auth, updatePropertyOwner);
router.delete("/property-owners/:id", auth, deletePropertyOwner);

// ═════════════════════════════════════════════════════════════
// PROPERTY UTILITIES ROUTES
// ═════════════════════════════════════════════════════════════
router.put("/properties/:propertyId/utilities", auth, upsertPropertyUtilities);
router.get("/properties/:propertyId/utilities", getPropertyUtilities);

// ═════════════════════════════════════════════════════════════
// PROPERTY ROAD ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/properties/:propertyId/roads", auth, createPropertyRoad);
router.get("/properties/:propertyId/roads", getPropertyRoads);
router.put("/property-roads/:id", auth, updatePropertyRoad);
router.delete("/property-roads/:id", auth, deletePropertyRoad);

// ═════════════════════════════════════════════════════════════
// PROPERTY PHOTO ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/properties/:propertyId/photos", auth, upload.any(), createPropertyPhoto);
router.get("/properties/:propertyId/photos", getPropertyPhotos);
router.delete("/property-photos/:id", auth, deletePropertyPhoto);

// ═════════════════════════════════════════════════════════════
// BUILDING ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/properties/:propertyId/building", auth, createBuilding);
router.get("/properties/:propertyId/building", getBuildingByProperty);
router.put("/buildings/:id", auth, updateBuilding);
router.delete("/buildings/:id", auth, deleteBuilding);

// ═════════════════════════════════════════════════════════════
// FLOOR ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/buildings/:buildingId/floors", auth, createFloor);
router.get("/buildings/:buildingId/floors", getFloorsByBuilding);
router.get("/floors/:id", getFloorById);
router.put("/floors/:id", auth, updateFloor);
router.delete("/floors/:id", auth, deleteFloor);

// ═════════════════════════════════════════════════════════════
// FLOOR UTILITIES ROUTES
// ═════════════════════════════════════════════════════════════
router.put("/floors/:floorId/utilities", auth, upsertFloorUtilities);
router.get("/floors/:floorId/utilities", getFloorUtilities);

// ═════════════════════════════════════════════════════════════
// FLOOR OCCUPANCY ROUTES
// ═════════════════════════════════════════════════════════════
router.put("/floors/:floorId/occupancy", auth, createFloorOccupancy);
router.get("/floors/:floorId/occupancy", getFloorOccupancy);
router.put("/floor-occupancy/:id", auth, updateFloorOccupancy);
router.delete("/floor-occupancy/:id", auth, deleteFloorOccupancy);

// ═════════════════════════════════════════════════════════════
// UNIT ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/floors/:floorId/units", auth, createUnit);
router.get("/floors/:floorId/units", getUnitsByFloor);
router.get("/units/:id", getUnitById);
router.put("/units/:id", auth, updateUnit);
router.delete("/units/:id", auth, deleteUnit);

// ═════════════════════════════════════════════════════════════
// UNIT OWNER ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/units/:unitId/owners", auth, createUnitOwner);
router.get("/units/:unitId/owners", getUnitOwners);
router.put("/unit-owners/:id", auth, updateUnitOwner);
router.delete("/unit-owners/:id", auth, deleteUnitOwner);

// ═════════════════════════════════════════════════════════════
// UNIT UTILITIES ROUTES
// ═════════════════════════════════════════════════════════════
router.put("/units/:unitId/utilities", auth, upsertUnitUtilities);
router.get("/units/:unitId/utilities", getUnitUtilities);

// ═════════════════════════════════════════════════════════════
// UNIT PHOTO ROUTES
// ═════════════════════════════════════════════════════════════
router.post("/units/:unitId/photos", auth, upload.any(), createUnitPhoto);
router.get("/units/:unitId/photos", getUnitPhotos);
router.put("/unit-photos/:id", auth, upload.any(), updateUnitPhoto);
router.delete("/unit-photos/:id", auth, deleteUnitPhoto);

module.exports = router;
