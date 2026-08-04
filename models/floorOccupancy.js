module.exports = (sequelize, DataTypes) => {
    const FloorOccupancy = sequelize.define("FloorOccupancy", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        floor_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        occupancy_status: {
            type: DataTypes.ENUM("Self", "Rented", "Vacant", "SelfRented"),
            allowNull: false,
        },

        // Self → carpet_area
        // Rented → occupant_name, occupant_mobile, rent_amount
        // Vacant → carpet_area
        // SelfRented → carpet_area, occupant_name, occupant_mobile, rent_amount

        carpet_area: {
            type: DataTypes.FLOAT,
            comment: "Area for Self, Vacant, SelfRented",
        },
        area: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue("carpet_area");
            },
            set(value) {
                this.setDataValue("carpet_area", value);
            },
            comment: "Backward-compatible alias for carpet_area",
        },

        occupant_name: {
            type: DataTypes.STRING,
            comment: "Occupier name for Rented and SelfRented",
        },

        occupant_mobile: {
            type: DataTypes.STRING,
            comment: "Occupier mobile for Rented and SelfRented",
        },

        rent_amount: DataTypes.FLOAT,
    });

    return FloorOccupancy;
};
