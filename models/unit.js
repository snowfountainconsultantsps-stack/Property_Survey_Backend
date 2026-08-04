module.exports = (sequelize, DataTypes) => {
    const Unit = sequelize.define("Unit", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        floor_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        unit_number: DataTypes.STRING,

        unit_address: DataTypes.TEXT,

        carpet_area: DataTypes.FLOAT,

        construction_year: DataTypes.INTEGER,

        occupancy_status: {
            type: DataTypes.ENUM("Self", "Rented", "Vacant", "SelfRented"),
            comment:
                "Self → area only. Rented → occupant_name, occupant_mobile. Vacant → area only. SelfRented → area + occupant_name, occupant_mobile.",
        },

        // Occupant details (for Rented / SelfRented)
        occupant_name: {
            type: DataTypes.STRING,
            comment: "Filled when occupancy is Rented or SelfRented",
        },

        occupant_mobile: {
            type: DataTypes.STRING,
            comment: "Filled when occupancy is Rented or SelfRented",
        },

        rent_amount: DataTypes.FLOAT,
    });

    return Unit;
};
