const express = require("express");
const { auth, authorize } = require("../middleware/auth");
const {
    listAssignments,
    createAssignment,
    deleteAssignment,
    myAssignments,
    performance,
} = require("../controllers/assignmentController");

const router = express.Router();

const MANAGER = authorize("ADMIN", "SUPERVISOR");

// The logged-in surveyor's own allocation + progress. Declared before the
// admin routes so "me" isn't captured as an id.
router.get("/me", auth, myAssignments);

// Admin: who is allocated where, and how they are doing.
router.get("/performance", auth, MANAGER, performance);
router.get("/", auth, MANAGER, listAssignments);
router.post("/", auth, MANAGER, createAssignment);
router.delete("/:id", auth, MANAGER, deleteAssignment);

module.exports = router;
