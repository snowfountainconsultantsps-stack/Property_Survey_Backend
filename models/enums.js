module.exports = {
    PropertyType: ["Residential", "NonResidential", "Mixed", "Vacant"],

    PropertySubtype: [
        "SingleStory",
        "MultiStory",
        "Commercial",
        "PetrolPump",
        "CommercialComplex",
    ],

    // Subtypes allowed per type
    SubtypeMapping: {
        Residential: ["SingleStory", "MultiStory"],
        NonResidential: ["Commercial", "PetrolPump", "CommercialComplex"],
        Mixed: [],
        Vacant: [],
    },

    // Types/subtypes that allow multiple entries per polygon
    MultiEntrySubtypes: ["MultiStory", "CommercialComplex"],

    OccupancyStatus: ["Self", "Rented", "Vacant", "SelfRented"],

    RoadSide: ["Front", "Left", "Right", "Back"],

    FloorUse: ["Unit", "Parking", "Both"],

    GisStatus: ["RAW", "SURVEYED", "SPLIT", "FINAL"],

    BuildingOccupancy: ["Self", "Rented", "Vacant", "SelfRented"],

    SurveyStatus: ["assigned", "in_progress", "completed", "reviewed", "rejected"],

    UserRole: ["ADMIN", "SUPERVISOR", "SURVEYOR", "GIS_EDITOR", "GIS_ADMIN"],
};
