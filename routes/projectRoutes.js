const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const {
    createProject,
    getProjects,
    getProjectById,
    getProjectSummary,
    updateProject,
    deleteProject,
} = require("../controllers/projectController");

const router = express.Router();

// Roles allowed to create/manage projects.
const PROJECT_ADMIN = authorize("ADMIN", "GIS_ADMIN");

router.post("/", auth, PROJECT_ADMIN, createProject);
router.get("/", auth, getProjects);
router.get("/:id", auth, getProjectById);
router.get("/:id/summary", auth, getProjectSummary);
router.put("/:id", auth, PROJECT_ADMIN, updateProject);
router.delete("/:id", auth, PROJECT_ADMIN, deleteProject);

module.exports = router;
