const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./database/db");
const PORT = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// ROUTES //

// For retrieving a list of all the inventory items
app.get('/api/inventory', async (req, res) => {
    try {
        const allInventory = await pool.query("SELECT * FROM hub_inv");
        res.json(allInventory.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});

// For retrieving details of a specific inventory item by its ID
app.get('/api/inventory/:item_id', async (req, res) => {
    try {
        // Extract the ID from the request parameters
        const { item_id } = req.params;

        // Perform a SELECT operation in the database using provided ID
        const item = await pool.query(
            "SELECT * FROM hub_inv WHERE item_id = $1", [item_id]
        );

        // Check if the item was found
        if (item.rows.length === 0) {
            return res.status(404).json({ message: "Item not found" });
        }
        res.json(item.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// For adding a new inventory item
app.post('/api/inventory', async (req, res) => {
    try {
        const { item_name, total_qty } = req.body;

        const newItem = await pool.query(
            "INSERT INTO hub_inv (item_name, total_qty) VALUES ($1, $2) RETURNING *",
            [item_name, total_qty]
        );
        res.json(newItem.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});

// For deleting an inventory item by its ID
app.delete('/api/inventory/:item_id', async (req, res) => {
    try {

        // Extract ID from the requested parameters
        const { item_id } = req.params;

        // Perform DELETE operation in the database using the provided ID
        const deleteItem = await pool.query(
            "DELETE FROM hub_inv WHERE item_id = $1 RETURNING *", [item_id]
        );

        // If no rows are returned, then the item does not exist
        if (deleteItem.rowCount === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        // Send a response indicating successful deletion
        res.json({ message: "Item deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// For updating an existing inventory item by its ID
app.put('/api/inventory/:item_id', async (req, res) => {
    try {
        // Extract ID from request parameters
        const { item_id } = req.params;

        // Extract the data to be updated from the request body
        const { item_name, total_qty } = req.body;

        // Perform an UPDATE operation in database using provided ID and new data
        const updateItem = await pool.query(
            "UPDATE hub_inv SET item_name = $1, total_qty = $2 WHERE item_id = $3 RETURNING *",
            [item_name, total_qty, item_id]
        );
        // If no rows are returned, then the item does not exist
        if (updateItem.rowCount === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        // Send a response with the updated item data
        res.json(updateItem.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


app.listen(PORT, () => {
    console.log(`server has started on port ${PORT}`);
})
