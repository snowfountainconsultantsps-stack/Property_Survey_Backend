module.exports = (sequelize, DataTypes) => {
    const Floor = sequelize.define("Floor", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        building_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        floor_number: {
            type: DataTypes.INTEGER,
            allowNull: false,
            comment: "0 = Ground, 1+ = above ground, -1 and below = basement",
        },

        construction_year: DataTypes.INTEGER,

        carpet_area: DataTypes.FLOAT,

        // For MultiStory / CommercialComplex
        floor_use: {
            type: DataTypes.ENUM("Unit", "Parking", "Both"),
            comment: "Used for MultiStory & CommercialComplex. Null for single-entry types.",
        },

        number_of_units: {
            type: DataTypes.INTEGER,
            comment: "Number of units on this floor. Used when floor_use is Unit or Both.",
        },

        // For single-entry types (SingleStory, Commercial, PetrolPump, Mixed)
        occupancy_status: {
            type: DataTypes.ENUM("Self", "Rented", "Vacant", "SelfRented"),
            comment: "Floor-level occupancy for single-entry types. For multi-entry types, occupancy is at unit level.",
        },

        occupant_name: {
            type: DataTypes.STRING,
            comment: "Filled when occupancy is Rented or SelfRented",
        },

        occupant_mobile: {
            type: DataTypes.STRING,
            comment: "Filled when occupancy is Rented or SelfRented",
        },
    });

    return Floor;
};
