const express = require("express");
const path = require('path');
const app = express();
const cors = require("cors");
const pool = require("./database/db");
const PORT = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

// Serve static files from the React frontend app
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'client/build')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname + '/client/build/index.html'));
    });
}

// ROUTES //

// For retrieving a list of all the inventory items
app.get('/api/inventory', async (req, res) => {
    try {
        const allInventory = await pool.query("SELECT * FROM hub_items");
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
            "SELECT * FROM hub_items WHERE item_id = $1", [item_id]
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
            "INSERT INTO hub_items (item_name, total_qty) VALUES ($1, $2) RETURNING *",
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
            "DELETE FROM hub_items WHERE item_id = $1 RETURNING *", [item_id]
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
            "UPDATE hub_items SET item_name = $1, total_qty = $2 WHERE item_id = $3 RETURNING *",
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

app.post('/api/inventory/borrow', async (req, res) => {
    const { item_id, student_id, quantity } = req.body;

    // Basic validation
    if (!item_id || !student_id || !quantity) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        await pool.query('BEGIN'); // Start a transaction

        // Check if enough items are available
        const itemCheck = await pool.query(
            'SELECT qty_available FROM hub_items WHERE item_id = $1', [item_id]
        );

        if (itemCheck.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ error: 'Item not found' });
        }

        if (itemCheck.rows[0].qty_available < quantity) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ error: 'Not enough items available' });
        }

        // Update hub_items table
        await pool.query(
            'UPDATE hub_items SET qty_borrowed = qty_borrowed + $1, qty_available = qty_available - $1 WHERE item_id = $2',
            [quantity, item_id]
        );

        // Insert into BorrowRequests table
        await pool.query(
            'INSERT INTO BorrowRequests (student_id, item_id, qty_requested, status) VALUES ($1, $2, $3, $4)',
            [student_id, item_id, quantity, 'Pending']
        );

        await pool.query('COMMIT'); // Commit the transaction

        res.json({ message: 'Item borrowed successfully' });
    } catch (err) {
        await pool.query('ROLLBACK'); // Rollback in case of an error
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

app.post('/api/inventory/return', async (req, res) => {
    const { item_id, student_id, quantity } = req.body;

    // Basic validation
    if (!item_id || !student_id || !quantity) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        await pool.query('BEGIN'); // Start a transaction

        // Update hub_items table
        await pool.query(
            'UPDATE hub_items SET qty_borrowed = qty_borrowed - $1, qty_available = qty_available + $1 WHERE item_id = $2',
            [quantity, item_id]
        );

        // Update the BorrowedItems table
        await pool.query(
            `UPDATE BorrowedItems
             SET qty_returned = qty_returned + $1
             FROM BorrowRequests
             WHERE BorrowedItems.request_id = BorrowRequests.request_id
             AND BorrowRequests.student_id = $2
             AND BorrowedItems.item_id = $3
             AND BorrowedItems.qty_returned + $1 <= BorrowedItems.qty_borrowed`,
            [quantity, student_id, item_id]
        );

        await pool.query('COMMIT'); // Commit the transaction

        res.json({ message: 'Item returned successfully' });
    } catch (err) {
        await pool.query('ROLLBACK'); // Rollback in case of an error
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// To validate the received data, check inventory availability, and update the database accordingly.
app.post('/api/excel-update', async (req, res) => {
    try {
        const {
            ID,
            'Completion time': completion_time,
            Email: email,
            Name: name,
            'Item name 1': item_name_1,
            'Quantity 1': quantity_1,
            'Item name 2': item_name_2,
            'Quantity 2': quantity_2,
            'Item name 3': item_name_3,
            'Quantity 3': quantity_3,
            'Item name 4': item_name_4,
            'Quantity 4': quantity_4,
            'Item name 5': item_name_5,
            'Quantity 5': quantity_5,
            'Matric or Staff No (starting with A)': matric_or_staff_no,
            'Project title': project_title,
            'Project Code': project_code,
            'Phone number (without +65)': phone_number,
            'Start usage date': start_usage_date,
            'End Usage Date': end_usage_date,
            'Location of Usage': location_of_usage,
            'Purpose of Usage': purpose_of_usage,
            'Name of Project Supervisor': project_supervisor_name,
            'Email of Supervisor': supervisor_email,
            'Additional Remarks': additional_remarks
        } = req.body;

        const query = `
            INSERT INTO form_responses 
            (ID, completion_time, email, name, item_name_1, quantity_1, 
            item_name_2, quantity_2, item_name_3, quantity_3, 
            item_name_4, quantity_4, item_name_5, quantity_5, 
            matric_or_staff_no, project_title, project_code, 
            phone_number, start_usage_date, end_usage_date, 
            location_of_usage, purpose_of_usage, project_supervisor_name, 
            supervisor_email, additional_remarks, is_deleted) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, FALSE)
            ON CONFLICT (ID) DO UPDATE SET 
            completion_time = EXCLUDED.completion_time, 
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            item_name_1 = EXCLUDED.item_name_1,
            quantity_1 = EXCLUDED.quantity_1,
            item_name_2 = EXCLUDED.item_name_2,
            quantity_2 = EXCLUDED.quantity_2,
            item_name_3 = EXCLUDED.item_name_3,
            quantity_3 = EXCLUDED.quantity_3,
            item_name_4 = EXCLUDED.item_name_4,
            quantity_4 = EXCLUDED.quantity_4,
            item_name_5 = EXCLUDED.item_name_5,
            quantity_5 = EXCLUDED.quantity_5,
            matric_or_staff_no = EXCLUDED.matric_or_staff_no,
            project_title = EXCLUDED.project_title,
            project_code = EXCLUDED.project_code,
            phone_number = EXCLUDED.phone_number,
            start_usage_date = EXCLUDED.start_usage_date,
            end_usage_date = EXCLUDED.end_usage_date,
            location_of_usage = EXCLUDED.location_of_usage,
            purpose_of_usage = EXCLUDED.purpose_of_usage,
            project_supervisor_name = EXCLUDED.project_supervisor_name,
            supervisor_email = EXCLUDED.supervisor_email,
            additional_remarks = EXCLUDED.additional_remarks,
            is_deleted = FALSE
        `;

        const values = [
            ID, completion_time, email, name, item_name_1, quantity_1,
            item_name_2, quantity_2, item_name_3, quantity_3,
            item_name_4, quantity_4, item_name_5, quantity_5,
            matric_or_staff_no, project_title, project_code,
            phone_number, start_usage_date, end_usage_date,
            location_of_usage, purpose_of_usage, project_supervisor_name,
            supervisor_email, additional_remarks
        ];

        await pool.query(query, values);

        res.status(200).json({ message: 'Data inserted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});




app.listen(PORT, () => {
    console.log(`server has started on port ${PORT}`);
})
