const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

let currentEmergencyAlert = "CRITICAL NEED: O- Negative Blood urgently required at FMC Keffi. Contact registry helpline.";
let alertActive = true;

const db = new sqlite3.Database('./donors.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Database Setup (Donors, Activity Logs, Admins)
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS donors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            blood_group TEXT NOT NULL,
            contact_preference TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            consent INTEGER NOT NULL,
            last_donated_date TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create Admins Table & Insert Default Admin if Empty
    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        db.get(`SELECT COUNT(*) as count FROM admins`, [], (err, row) => {
            if (row && row.count === 0) {
                db.run(`INSERT INTO admins (username, password) VALUES ('Aliyu Shehu', 'Candcbbf10')`);
            }
        });
    });
});

const logActivity = (action, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    db.run(`INSERT INTO activity_logs (action, ip_address) VALUES (?, ?)`, [action, ip]);
};

// API: Public Donor Registration
app.post('/api/donors', (req, res) => {
    const { full_name, blood_group, contact_preference, phone, email, consent, last_donated_date } = req.body;

    if (!consent) return res.status(400).json({ error: 'Consent is required to join the registry.' });
    if (!full_name || !blood_group || !contact_preference) {
        return res.status(400).json({ error: 'Please fill in all required fields.' });
    }

    const query = `
        INSERT INTO donors (full_name, blood_group, contact_preference, phone, email, consent, last_donated_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    db.run(query, [full_name, blood_group, contact_preference, phone || '', email || '', consent ? 1 : 0, last_donated_date || ''], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        
        logActivity(`Registered new donor: ${full_name} (${blood_group})`, req);
        res.status(201).json({ 
            message: 'Donor registered successfully! Awaiting Admin Approval.', 
            id: this.lastID,
            donor: { id: this.lastID, full_name, blood_group, contact_preference, phone, email, last_donated_date }
        });
    });
});

// API: Public Search Approved Donors (Case-Insensitive Fix)
app.get('/api/donors/search', (req, res) => {
    const { blood_group, search } = req.query;
    let query = `SELECT id, full_name, blood_group, contact_preference, phone, email, last_donated_date, created_at 
                 FROM donors WHERE (LOWER(status) = 'approved' OR LOWER(status) = 'active')`;
    const params = [];

    if (blood_group && blood_group.trim() !== '') {
        query += ` AND blood_group = ?`;
        params.push(blood_group.trim());
    }

    if (search && search.trim() !== '') {
        query += ` AND (LOWER(full_name) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) OR phone LIKE ?)`;
        const term = `%${search.trim()}%`;
        params.push(term, term, term);
    }

    query += ` ORDER BY id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// API: Dynamic Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admins WHERE username = ? AND password = ?`, [username, password], (err, admin) => {
        if (err) return res.status(500).json({ error: err.message });
        if (admin) {
            logActivity(`Admin logged in: ${username}`, req);
            return res.json({ success: true, username: admin.username });
        }
        res.status(401).json({ error: 'Invalid username or password.' });
    });
});

// API: Admin Management - Get All Admins
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT id, username, created_at FROM admins ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Admin Management - Add New Admin
app.post('/api/admin/users', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    db.run(`INSERT INTO admins (username, password) VALUES (?, ?)`, [username.trim(), password.trim()], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists.' });
            return res.status(500).json({ error: err.message });
        }
        logActivity(`Created new admin user: ${username}`, req);
        res.status(201).json({ message: 'Admin user created successfully.' });
    });
});

// API: Admin Management - Remove Admin
app.delete('/api/admin/users/:id', (req, res) => {
    const adminId = req.params.id;

    db.get(`SELECT COUNT(*) as count FROM admins`, [], (err, row) => {
        if (row && row.count <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last admin user.' });
        }

        db.run(`DELETE FROM admins WHERE id = ?`, [adminId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logActivity(`Deleted admin user ID: ${adminId}`, req);
            res.json({ message: 'Admin removed successfully.' });
        });
    });
});

// API: Get Donors + Stats
app.get('/api/admin/donors', (req, res) => {
    db.all(`SELECT * FROM donors ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const total = rows.length;
        const approved = rows.filter(r => (r.status || '').toLowerCase() === 'approved' || (r.status || '').toLowerCase() === 'active').length;
        const pending = rows.filter(r => (r.status || '').toLowerCase() === 'pending').length;

        const groupCounts = {};
        rows.forEach(r => { groupCounts[r.blood_group] = (groupCounts[r.blood_group] || 0) + 1; });
        let topGroup = 'N/A';
        let maxCount = 0;
        for (const g in groupCounts) {
            if (groupCounts[g] > maxCount) { maxCount = groupCounts[g]; topGroup = g; }
        }

        res.json({
            donors: rows,
            stats: { total, approved, pending, topGroup }
        });
    });
});

// API: Update Donor Status
app.patch('/api/admin/donors/:id/status', (req, res) => {
    const donorId = req.params.id;
    const { status } = req.body;

    db.run(`UPDATE donors SET status = ? WHERE id = ?`, [status, donorId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(`Admin updated donor ID ${donorId} status to: ${status}`, req);
        res.json({ message: `Donor status updated to ${status}.` });
    });
});

// API: Permanently Delete Donor Record
app.delete('/api/admin/donors/:id', (req, res) => {
    const donorId = req.params.id;

    db.run(`DELETE FROM donors WHERE id = ?`, [donorId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        logActivity(`Admin permanently deleted donor ID ${donorId}`, req);
        res.json({ message: `Donor record ID ${donorId} permanently deleted.` });
    });
});

// API: Alerts & Logs
app.get('/api/alert', (req, res) => { res.json({ alert: currentEmergencyAlert, active: alertActive }); });

app.post('/api/admin/alert', (req, res) => {
    const { message, active } = req.body;
    currentEmergencyAlert = message || '';
    alertActive = !!active;
    logActivity(`Admin updated emergency broadcast alert.`, req);
    res.json({ success: true, alert: currentEmergencyAlert, active: alertActive });
});

app.post('/api/visit', (req, res) => { logActivity('Page Visit', req); res.json({ status: 'logged' }); });

app.get('/api/admin/logs', (req, res) => {
    db.all(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
