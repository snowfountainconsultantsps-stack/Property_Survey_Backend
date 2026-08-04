const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const upload = require("../config/uploadCloud");
const {
    createDraftSurvey,
    addPropertyDetails,
    addBuildingInfo,
    addFloor,
    addUnit,
    uploadSurveyPhotos,
    submitSurvey,
    updateSurveyProgress,
    getSurveyById,
    getSurveyorSurveys,
    getSurveyorTodaysSurveys,
    getTodaysSurveys,
    deleteSurveyImage,
} = require("../controllers/wizardController");

const router = express.Router();

// ── Named/prefix routes BEFORE /:id to avoid param collisions ──

/** GET  /api/surveys/today  — admin: all surveys today */
router.get("/today", auth, getTodaysSurveys);

/** GET  /api/surveys/surveyor/:surveyorId */
router.get("/surveyor/:surveyorId", auth, getSurveyorSurveys);

/** GET  /api/surveys/surveyor/:surveyorId/today */
router.get("/surveyor/:surveyorId/today", auth, getSurveyorTodaysSurveys);

// ── Wizard steps ───────────────────────────────────────────────

/** POST /api/surveys/draft — Step 1: create draft */
router.post("/draft", auth, createDraftSurvey);

/** GET  /api/surveys/:id — full survey detail (resume support) */
router.get("/:id", auth, getSurveyById);

/** PUT  /api/surveys/:id/property-details — Step 2 */
router.put("/:id/property-details", auth, addPropertyDetails);

/** PUT  /api/surveys/:id/building — Step 3 */
router.put("/:id/building", auth, addBuildingInfo);

/** POST /api/surveys/:id/floors — Step 4 */
router.post("/:id/floors", auth, addFloor);

/** POST /api/surveys/:id/units — Step 4/5 */
router.post("/:id/units", auth, addUnit);

/** POST /api/surveys/:id/photos — Step 6 */
// upload.any() accepts image files under any field name ("images"/"photos")
router.post("/:id/photos", auth, upload.any(), uploadSurveyPhotos);

/** POST /api/surveys/:id/submit — Step 7 */
router.post("/:id/submit", auth, submitSurvey);

/** PUT /api/surveys/:id/progress — remember wizard resume position */
router.put("/:id/progress", auth, updateSurveyProgress);

/** DELETE /api/surveys/image/:imageId */
router.delete("/image/:imageId", auth, deleteSurveyImage);

module.exports = router;
