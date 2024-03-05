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

app.get('/', (req, res) => {
    res.send('Temporary response for debugging');
});


app.get('/api/inventory', async (req, res) => {
    try {
        // Adjusted SQL query to only select items where loanable is 'Yes'
        const allInventory = await pool.query("SELECT * FROM hub_items_unique WHERE loanable = 'true'");
        res.json(allInventory.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});

// Endpoint to get size_specs and model by item_id
app.get('/api/item-details/:item_id', async (req, res) => {
    try {
        const { item_id } = req.params;
        const itemDetails = await pool.query("SELECT model, size_specs FROM hub_items_new WHERE item_id = $1", [item_id]);

        if (itemDetails.rows.length === 0) {
            return res.status(404).json({ message: "Item details not found" });
        }

        res.json(itemDetails.rows[0]);
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
            "SELECT * FROM hub_items_unique WHERE item_id = $1", [item_id]
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
            course_code, // Changed from project_title
            project_code,
            phone_number,
            start_usage_date,
            end_usage_date,
            project_supervisor_name,
            supervisor_email
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

        const query = `
            INSERT INTO form_responses 
            (ID, completion_time, email, name, item_name_1, quantity_1, 
            item_name_2, quantity_2, item_name_3, quantity_3, 
            item_name_4, quantity_4, item_name_5, quantity_5, 
            course_code, project_code,
            phone_number, start_usage_date, end_usage_date, 
            project_supervisor_name, 
            supervisor_email, is_deleted) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, FALSE)
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
            course_code = EXCLUDED.course_code, // Changed from project_title to course_code
            project_code = EXCLUDED.project_code,
            phone_number = EXCLUDED.phone_number,
            start_usage_date = EXCLUDED.start_usage_date,
            end_usage_date = EXCLUDED.end_usage_date,
            project_supervisor_name = EXCLUDED.project_supervisor_name,
            supervisor_email = EXCLUDED.supervisor_email,
            is_deleted = FALSE
        `;

        const values = [
            ID, processedCompletionTime, email, name, item_name_1, convertedQuantity1,
            item_name_2, convertedQuantity2, item_name_3, convertedQuantity3,
            item_name_4, convertedQuantity4, item_name_5, convertedQuantity5,
            course_code, // Changed from project_title
            project_code,
            phone_number, processedStartDate, processedEndDate,
            project_supervisor_name,
            supervisor_email
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

// To insert student data into the database using project code
app.post('/api/insert-students', async (req, res) => {
    try {
        // Destructure the received data
        const { name, email, phone_number, project_code } = req.body;

        // Check if the student already exists by project_code
        const existingStudent = await pool.query('SELECT student_id FROM students WHERE phone_number = $1', [phone_number]);

        if (existingStudent.rows.length === 0) {
            // If the student does not exist, insert them into the database
            await pool.query('INSERT INTO students (name, email, phone_number, project_code) VALUES ($1, $2, $3, $4)', [name, email, phone_number, project_code]);
            res.status(200).json({ message: 'Student data processed successfully' });
        } else {
            // If a student with the same project code exists, respond accordingly
            res.status(200).json({ message: 'Student with this phone number already exists' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});



// To retrieve the student ID of a student using their email
app.get('/api/get-student-id', async (req, res) => {
    try {

        // Get email from query parameters
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        // Query the database to find the student_id by email
        const studentResult = await pool.query('SELECT student_id FROM students WHERE email = $1', [email]);

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



// To retrieve the transaction ID using the student's phone number
app.get('/api/get-transaction-id', async (req, res) => {
    try {
        const phoneNumber = req.query.phone_number; // Get phone_number from query parameters

        if (!phoneNumber) {
            return res.status(400).json({ message: "Phone number is required" });
        }

        // Query the database to find the transaction_id by phone_number
        const transactionResult = await pool.query('SELECT transaction_id FROM loan_transaction WHERE phone_number = $1', [phoneNumber]);

        if (transactionResult.rows.length > 0) {
            // Transaction found, return the transaction_id
            const transId = transactionResult.rows[0].transaction_id;
            res.json({ transaction_id: transId });
        } else {
            // Transaction not found
            res.status(404).json({ message: "Transaction not found" });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});


app.post('/api/loan-transaction/add', async (req, res) => {
    try {
        // Destructure the required data from the request body
        const { email, start_usage_date, end_usage_date, status } = req.body;

        // Basic validation to check if all required fields are present
        if (!email || !start_usage_date || !end_usage_date || !status) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify if the student exists based on the email
        const studentExists = await pool.query(
            "SELECT * FROM students WHERE email = $1",
            [email]
        );

        if (studentExists.rows.length === 0) {
            // If the student doesn't exist, respond with an error
            return res.status(404).json({ error: 'Student not found with the given email' });
        }

        // Assuming student_id is still needed for the loan_transaction table, you would retrieve it from the studentExists query
        const student_id = studentExists.rows[0].student_id;

        // Insert the new loan transaction data into the loan_transaction table
        const newLoanTransaction = await pool.query(
            "INSERT INTO loan_transaction (student_id, start_usage_date, end_usage_date, status, email) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [student_id, start_usage_date, end_usage_date, status, email]
        );

        // Send back the inserted loan transaction data
        res.json(newLoanTransaction.rows[0]);
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("Server error");
    }
});



const formatDate = (date) => {
    const pad = (num) => num < 10 ? '0' + num : num.toString();

    // Convert to Singapore Time (GMT+8)
    const sgTimeOffset = 8 * 60; // offset in minutes
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset() + sgTimeOffset);

    const month = pad(date.getMonth() + 1); // getMonth() is zero-based
    const day = pad(date.getDate());
    const year = date.getFullYear().toString().substr(-2); // last two digits of the year
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
};

app.post('/api/submit-form', async (req, res) => {
    try {
        // Removed purpose_of_usage from the destructuring assignment
        const {
            email, name, course_code, project_code,
            phone_number, start_usage_date, end_usage_date,
            project_supervisor_name, supervisor_email
        } = req.body;

        // Prepare the data for Power Automate, excluding purpose_of_usage
        let formData = {
            completion_time: formatDate(new Date()), // Assuming formatDate is correctly defined elsewhere
            email, name, course_code, project_code,
            phone_number, start_usage_date, end_usage_date,
            project_supervisor_name, supervisor_email
        };

        // Handle item_id_, item_name_, and quantity_ fields dynamically
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('item_id_') || key.startsWith('item_name_') || key.startsWith('quantity_')) {
                formData[key] = String(req.body[key]);
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



app.post('/api/import-excel-data', async (req, res) => {
    const record = req.body; // The body is an object representing a single record
    let client;

    try {
        // Convert empty strings for numeric fields to null (or a default value)
        const convertToInt = (value) => value === "" ? null : parseInt(value, 10);

        const totalQty = convertToInt(record.TotalQty);
        const qtyAvailable = convertToInt(record.QtyAvailable);
        const qtyReserved = convertToInt(record.QtyReserved);
        const qtyBorrowed = convertToInt(record.QtyBorrowed);

        const loanable = record.Loanable === "Yes"; // Assuming Loanable is a Yes/No string
        const requiresApproval = record.RequiresApproval === "Yes"; // Assuming RequiresApproval is a Yes/No string

        // Extract new fields from the request body
        const model = record.Model;
        const sizeSpecs = record.SizeSpecs;
        const category = record.Category;

        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(`
            INSERT INTO hub_items_unique
            (item_id, item_name, brand, total_qty, qty_available, qty_reserved, qty_borrowed, loanable, requires_approval, model, size_specs, category)
            VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (item_id)
            DO UPDATE SET
            item_name = EXCLUDED.item_name,
            brand = EXCLUDED.brand,
            total_qty = EXCLUDED.total_qty,
            qty_available = EXCLUDED.qty_available,
            qty_reserved = EXCLUDED.qty_reserved,
            qty_borrowed = EXCLUDED.qty_borrowed,
            loanable = EXCLUDED.loanable,
            requires_approval = EXCLUDED.requires_approval,
            model = EXCLUDED.model,
            size_specs = EXCLUDED.size_specs,
            category = EXCLUDED.category;
        `, [
            record.ItemID, record.ItemName, record.Brand, totalQty, qtyAvailable, qtyReserved, qtyBorrowed, loanable, requiresApproval, model, sizeSpecs, category
        ]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Data imported successfully', result: result.rows });
    } catch (err) {
        console.error('Error during data import:', err);
        if (client) {
            await client.query('ROLLBACK');
        }
        res.status(500).json({ message: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});




app.listen(PORT, '0.0.0.0', () => {
    console.log(`server has started on port ${PORT}`);
})
