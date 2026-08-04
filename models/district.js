module.exports = (sequelize, DataTypes) => {
    const District = sequelize.define("District", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        state_id: {
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

    return District;
};
