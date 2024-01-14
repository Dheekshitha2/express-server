require('dotenv').config();

const express = require("express");
const path = require('path');
const app = express();
const cors = require("cors");
const pool = require("./database/db");
const PORT = process.env.PORT || 5000;

const axios = require('axios');
const POWER_AUTOMATE_URL = 'https://prod-38.southeastasia.logic.azure.com:443/workflows/c84d30f1f09a4a508d19460c586eb699/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=iEx2kAsMLbNfEaMAIn6_rhJhtNq1yQ868rnFvmqouP8';

// middleware
app.use(cors());
app.use(express.json());

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
        // Destructure the received data
        const {
            ID,
            completion_time,
            email,
            name,
            item_name_1,
            quantity_1,
            item_name_2,
            quantity_2,
            item_name_3,
            quantity_3,
            item_name_4,
            quantity_4,
            item_name_5,
            quantity_5,
            matric_or_staff_no,
            project_title,
            project_code,
            phone_number,
            start_usage_date,
            end_usage_date,
            location_of_usage,
            purpose_of_usage,
            project_supervisor_name,
            supervisor_email,
            additional_remarks
        } = req.body;

        // Convert quantities from string to integer
        const convertedQuantity1 = parseInt(quantity_1) || 0;
        const convertedQuantity2 = quantity_2 ? parseInt(quantity_2) : null;
        const convertedQuantity3 = quantity_3 ? parseInt(quantity_3) : null;
        const convertedQuantity4 = quantity_4 ? parseInt(quantity_4) : null;
        const convertedQuantity5 = quantity_5 ? parseInt(quantity_5) : null;

        // Process date fields
        const processedCompletionTime = completion_time ? new Date(completion_time).toISOString() : null;
        const processedStartDate = start_usage_date ? new Date(start_usage_date).toISOString().split('T')[0] : null;
        const processedEndDate = end_usage_date ? new Date(end_usage_date).toISOString().split('T')[0] : null;

        // Prepare SQL query and values
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
            ID, processedCompletionTime, email, name, item_name_1, convertedQuantity1,
            item_name_2, convertedQuantity2, item_name_3, convertedQuantity3,
            item_name_4, convertedQuantity4, item_name_5, convertedQuantity5,
            matric_or_staff_no, project_title, project_code,
            phone_number, processedStartDate, processedEndDate,
            location_of_usage, purpose_of_usage, project_supervisor_name,
            supervisor_email, additional_remarks
        ];

        await pool.query(query, values);

        // Start updating hub_items and creating transaction records
        await pool.query('BEGIN');

        // Iterate through each item and update hub_items
        for (let i = 1; i <= 5; i++) {
            const itemNameInput = req.body[`item_name_${i}`];
            const quantity = parseInt(req.body[`quantity_${i}`]) || 0;

            if (itemNameInput && quantity > 0) {
                const itemNameLower = itemNameInput.toLowerCase();

                // Find the item_id for the given item name (case-insensitive)
                const itemResult = await pool.query(
                    'SELECT item_id FROM hub_items WHERE LOWER(item_name) = LOWER($1)',
                    [itemNameLower]
                );

                if (itemResult.rows.length > 0) {
                    const itemId = itemResult.rows[0].item_id;

                    // Update qty_available and qty_reserved for the found item
                    await pool.query(
                        'UPDATE hub_items SET qty_available = qty_available - $1, qty_reserved = qty_reserved + $1 WHERE item_id = $2',
                        [quantity, itemId]
                    );
                } else {
                    // Handle the case where the item is not found
                    console.log(`Item not found: ${itemNameInput}`);
                    // Insert this incident into a 'log' table in your database
                    await pool.query('INSERT INTO item_lookup_errors (input_name, timestamp) VALUES ($1, NOW())', [itemNameInput]);
                }
            }
        }

        // Check if student exists
        let studentId;
        const studentResult = await pool.query('SELECT student_id FROM students WHERE email = $1', [email]);
        if (studentResult.rows.length > 0) {
            studentId = studentResult.rows[0].student_id;
        } else {
            // Insert new student and get student_id
            const newStudentResult = await pool.query(
                'INSERT INTO students (name, email, phone_number) VALUES ($1, $2, $3) RETURNING student_id',
                [name, email, phone_number]
            );
            studentId = newStudentResult.rows[0].student_id;
        }

        // Check if supervisor exists
        let supervisorId;
        const supervisorResult = await pool.query('SELECT supervisor_id FROM supervisors WHERE email = $1', [supervisor_email]);
        if (supervisorResult.rows.length > 0) {
            supervisorId = supervisorResult.rows[0].supervisor_id;
        } else {
            // Insert new supervisor and get supervisor_id
            const newSupervisorResult = await pool.query(
                'INSERT INTO supervisors (name, email) VALUES ($1, $2) RETURNING supervisor_id',
                [project_supervisor_name, supervisor_email]
            );
            supervisorId = newSupervisorResult.rows[0].supervisor_id;
        }

        await pool.query('COMMIT'); // Commit the transaction here
        res.status(200).json({ message: 'Data inserted successfully' });
    } catch (err) {
        await pool.query('ROLLBACK'); // Rollback in case of an error
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// To insert student data into the database
app.post('/api/insert-students', async (req, res) => {
    try {
        // Destructure the received data
        const { name, email, phone_number, matric_no } = req.body;

        // Check if the student already exists by matric_no
        const existingStudent = await pool.query('SELECT student_id FROM students WHERE matric_no = $1', [matric_no]);

        if (existingStudent.rows.length === 0) {
            // If the student does not exist, insert them into the database
            await pool.query('INSERT INTO students (name, email, phone_number, matric_no) VALUES ($1, $2, $3, $4)', [name, email, phone_number, matric_no]);
            res.status(200).json({ message: 'Student data processed successfully' });
        } else {
            // If a student with the same matric_no exists, respond accordingly
            res.status(200).json({ message: 'Student with this matriculation number already exists' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});


// To retrieve the student ID of a student using their matric number
app.get('/api/get-student-id', async (req, res) => {
    try {
        const matricNo = req.query.matric_no; // Get matric_no from query parameters

        if (!matricNo) {
            return res.status(400).json({ message: "Matric number is required" });
        }

        // Query the database to find the student_id by matric_no
        const studentResult = await pool.query('SELECT student_id FROM students WHERE matric_no = $1', [matricNo]);

        if (studentResult.rows.length > 0) {
            // Student found, return the student_id
            const studentId = studentResult.rows[0].student_id;
            res.json({ student_id: studentId });
        } else {
            // Student not found
            res.status(404).json({ message: "Student not found" });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});


// Endpoint for adding a new student
app.post('/api/loan-transaction/add', async (req, res) => {
    try {
        // Destructure the required data from the request body
        const { student_id, start_usage_date, end_usage_date, status, matric_no } = req.body;

        // Basic validation to check if all required fields are present
        if (!student_id || !start_usage_date || !end_usage_date || !status || !matric_no) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Insert the new student data into the students table
        const newStudent = await pool.query(
            "INSERT INTO loan_transaction (student_id, start_usage_date, end_usage_date, status, matric_no) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [student_id, start_usage_date, end_usage_date, status, matric_no]
        );

        // Send back the inserted student data
        res.json(newStudent.rows[0]);
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("Server error");
    }
});

app.post('/api/submit-form', async (req, res) => {
    try {
        // Destructure the main fields from req.body
        const {
            email, name, matric_or_staff_no, project_title, project_code,
            phone_number, start_usage_date, end_usage_date, location_of_usage,
            purpose_of_usage, project_supervisor_name, supervisor_email,
            additional_remarks
        } = req.body;

        // Prepare the data for Power Automate
        let formData = {
            completion_time: new Date().toISOString(),
            email, name, matric_or_staff_no, project_title, project_code,
            phone_number, start_usage_date, end_usage_date, location_of_usage,
            purpose_of_usage, project_supervisor_name, supervisor_email,
            additional_remarks
        };

        Object.keys(req.body).forEach(key => {
            if (key.startsWith('item_name_') || key.startsWith('quantity_')) {
                // Convert quantities to string if they are not already
                if (key.startsWith('quantity_')) {
                    formData[key] = String(req.body[key]);
                } else {
                    formData[key] = req.body[key];
                }
            }
        });


        // Forward the data to Power Automate
        const powerAutomateResponse = await axios.post(POWER_AUTOMATE_URL, formData);

        res.status(200).json({ message: 'Form data submitted successfully', powerAutomateResponse: powerAutomateResponse.data });
    } catch (err) {
        console.error("Error occurred:", err);
        res.status(500).send('Server error');
    }
});



app.listen(PORT, '0.0.0.0', () => {
    console.log(`server has started on port ${PORT}`);
})
