const { sequelize } = require("../models");

exports.findPolygonByLocation = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    console.log("Received coordinates:", { lat, lng });
    if (!lat || !lng) {
      return res.status(400).json({ message: "Latitude and Longitude required" });
    }

    const [result] = await sequelize.query(`
      SELECT 
        p.id, 
        p.polygon_code, 
        p.ward_id,
        w.ward_name as ward_name,
        c.name as city_name,
        d.name as district_name,
        s.name as state_name,
        p.area_sqmt, 
        ST_AsGeoJSON(ST_Transform(ST_SetSRID(p.boundary, 32644), 4326)) as boundary,
        ST_Distance(
          ST_Transform(ST_SetSRID(p.boundary, 32644), 4326)::geography,
          ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
        ) as distance_meters,
        CASE 
          WHEN COUNT(b.id) > 0 THEN JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', b.id,
              'floors_above_ground', b.floors_above_ground,
              'floors_below_ground', b.floors_below_ground,
              'total_builtup_area', b.total_builtup_area,
              'construction_year', b.construction_year,
              'floors', (
                SELECT JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'id', f.id,
                    'floor_number', f.floor_number,
                    'carpet_area', f.carpet_area,
                    'units', (
                      SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                          'id', u.id,
                          'unit_number', u.unit_number,
                          'carpet_area', u.carpet_area
                        )
                      ) FILTER (WHERE u.id IS NOT NULL)
                      FROM "Units" u
                      WHERE u.floor_id = f.id
                    )
                  )
                ) FILTER (WHERE f.id IS NOT NULL)
                FROM "Floors" f
                WHERE f.building_id = b.id
              )
            )
          ) FILTER (WHERE b.id IS NOT NULL)
          ELSE NULL 
        END as buildings
      FROM "Polygons" p
      LEFT JOIN "Wards" w ON p.ward_id = w.id
      LEFT JOIN "Cities" c ON w.city_id = c.id
      LEFT JOIN "Districts" d ON c.district_id = d.id
      LEFT JOIN "States" s ON d.state_id = s.id
      LEFT JOIN "Properties" prop ON p.id = prop.polygon_id
      LEFT JOIN "Buildings" b ON prop.id = b.property_id
      WHERE ST_DWithin(
        ST_Transform(ST_SetSRID(p.boundary, 32644), 4326)::geography,
        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
        2  -- 2 meters tolerance
      )
      GROUP BY p.id, p.polygon_code, p.ward_id, w.ward_name, c.name, d.name, s.name, p.area_sqmt, p.boundary
      ORDER BY distance_meters ASC
    `, {
      replacements: { lat, lng }
    });

    if (result.length === 0) {
      return res.status(404).json({ message: "No nearby polygon found within 2 meters" });
    }

    console.log("Found polygon:", result);
    res.json({
      success: true,
      count: result.length,
      polygons: result
    });

  } catch (error) {
    console.error("GIS Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllPolygonsWithSurveyStatus = async (req, res) => {
  try {
    const [result] = await sequelize.query(`
      SELECT 
        p.id, 
        p.polygon_code, 
        p.ward_id,
        w.ward_name as ward_name,
        c.name as city_name,
        d.name as district_name,
        s.name as state_name,
        p.area_sqmt,
        p.gis_status,
        p.is_active,
        p."createdAt",
        CASE
          WHEN COUNT(surv.id) > 0 THEN true
          ELSE false
        END as survey_done,
        COUNT(DISTINCT CASE WHEN surv.id IS NOT NULL THEN 1 ELSE NULL END) as survey_count,
        MAX(surv."createdAt") as last_survey_date,
        MAX(surv.id) as latest_survey_id,
        ST_AsGeoJSON(ST_Transform(ST_SetSRID(p.boundary, 32644), 4326)) as boundary
      FROM "Polygons" p
      LEFT JOIN "Wards" w ON p.ward_id = w.id
      LEFT JOIN "Cities" c ON w.city_id = c.id
      LEFT JOIN "Districts" d ON c.district_id = d.id
      LEFT JOIN "States" s ON d.state_id = s.id
      LEFT JOIN "Properties" prop ON p.id = prop.polygon_id
      LEFT JOIN "Surveys" surv ON prop.id = surv.property_id
      WHERE p.is_active = true
      GROUP BY p.id, p.polygon_code, p.ward_id, w.ward_name, c.name, d.name, s.name, p.area_sqmt, p.gis_status, p.is_active, p."createdAt"
      ORDER BY p.polygon_code ASC
    `);

    res.json({
      success: true,
      count: result.length,
      polygons: result
    });

  } catch (error) {
    console.error("Error fetching polygons with survey status:", error);
    res.status(500).json({ message: "Server error" });
  }
};
