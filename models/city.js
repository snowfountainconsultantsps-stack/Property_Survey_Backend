module.exports = (sequelize, DataTypes) => {
    const City = sequelize.define("City", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        district_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        code: DataTypes.STRING(10),

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return City;
};
