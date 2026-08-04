module.exports = (sequelize, DataTypes) => {
    const Survey = sequelize.define("Survey", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        property_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        surveyor_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },

        polygon_id: DataTypes.INTEGER,

        // Project this survey belongs to (nullable — legacy data has none).
        project_id: DataTypes.INTEGER,

        survey_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },

        start_time: DataTypes.TIME,

        end_time: DataTypes.TIME,

        status: {
            type: DataTypes.ENUM("assigned", "in_progress", "completed", "reviewed", "rejected"),
            defaultValue: "assigned",
        },

        // How far the surveyor got in the multi-step wizard. Persisted here so
        // resuming works on any device and survives the app's local draft cache
        // being cleared — the cache is a convenience, this is the source of truth.
        current_step: {
            type: DataTypes.INTEGER,
            defaultValue: 1,
        },

        latitude: DataTypes.DOUBLE,

        longitude: DataTypes.DOUBLE,

        remarks: DataTypes.TEXT,

        supervisor_remarks: DataTypes.TEXT,

        reviewed_by: DataTypes.UUID,

        reviewed_at: DataTypes.DATE,

        is_synced: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    });

    return Survey;
};
