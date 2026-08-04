module.exports = (sequelize, DataTypes) => {
    const State = sequelize.define("State", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },

        code: {
            type: DataTypes.STRING(10),
            unique: true,
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return State;
};
