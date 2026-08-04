module.exports = (sequelize, DataTypes) => {
    // ──────────────────────────────────────────────────────────────
    // Project — the top-level container an admin creates for a survey /
    // asset-mapping engagement of an area. Shapefile uploads, asset features,
    // property surveys, etc. are all scoped to a project via project_id.
    // ──────────────────────────────────────────────────────────────
    const Project = sequelize.define("Project", {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        // Human/machine code, unique. Auto-filled as PRJ-<id> when not supplied.
        code: {
            type: DataTypes.STRING,
            unique: true,
        },

        description: DataTypes.TEXT,

        // Legacy free-text client name — superseded by the ULB link below,
        // kept so existing rows are unaffected.
        client_name: DataTypes.STRING,
        // Functional department the work is for, from a fixed list
        // (Water Works, Sewerage, …).
        department: DataTypes.STRING,

        // Administrative scope: State → District → City → ULB. Stored as ids
        // (denormalised) so the project list needs no joins to display them.
        state_id: DataTypes.INTEGER,
        district_id: DataTypes.INTEGER,
        city_id: DataTypes.INTEGER,
        ulb_id: DataTypes.INTEGER,
        ward_id: DataTypes.INTEGER,

        status: {
            type: DataTypes.ENUM("ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"),
            defaultValue: "ACTIVE",
        },

        start_date: DataTypes.DATEONLY,
        end_date: DataTypes.DATEONLY,

        // Admin (User.id UUID) who created the project.
        created_by: DataTypes.UUID,

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    });

    return Project;
};
