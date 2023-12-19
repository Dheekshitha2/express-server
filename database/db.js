const Pool = require('pg').Pool;

const pool = new Pool({
    user: "postgres",
    password: "$hreeDhee212",
    host: "localhost",
    port: 5432,
    database: "loaning_system",
})

module.exports = pool;
