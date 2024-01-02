const Pool = require('pg').Pool;

const pool = new Pool({
    user: process.env.DB_USER || "default_user",
    password: process.env.DB_PASSWORD || "default_password",
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_DATABASE || "loaning_system",
})

module.exports = pool;
