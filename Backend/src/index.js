import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { User, Prescription, AuditLog } from './models.js';
import { auth, allow } from './middleware.js';

const app = express();

//MIDDLEWARE

app.use(helmet({
    crossOriginResourcePolicy: {
        policy: 'cross-origin'
    }
}));

app.use(cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173'
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

//ROOT ROUTE

// NEW: Render browser URL check
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Prescripto Backend is running successfully!',
        service: 'Prescripto API'
    });
});

//UPLOAD CONFIGURATION

const uploads = path.resolve('uploads');

fs.mkdirSync(uploads, { recursive: true });

const storage = multer.diskStorage({
    destination: uploads,
    filename: (_, f, cb) => {
        cb(
            null,
            crypto.randomUUID() +
            path.extname(f.originalname).toLowerCase()
        );
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (_, f, cb) => {
        if (/\.(png|jpe?g|bmp|tiff)$/i.test(f.originalname)) {
            cb(null, true);
        } else {
            cb(new Error(
                'Unsupported image type. Upload JPG, PNG, BMP or TIFF.'
            ));
        }
    }
});

//HEALTH CHECK

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Prescripto API',
        database:
            mongoose.connection.readyState === 1
                ? 'connected'
                : 'disconnected'
    });
});

//PRESCRIPTION IMAGE

app.get('/api/prescriptions/:id/image', auth, async (req, res) => {
    try {
        const rx = await Prescription.findById(req.params.id);

        if (!rx) {
            return res.status(404).json({
                message: 'Prescription not found'
            });
        }

        const role = req.user.role;

        const allowed =
            role === 'admin' ||
            (role === 'doctor' && String(rx.doctor) === req.user.id) ||
            (role === 'patient' && String(rx.patient) === req.user.id) ||
            (role === 'pharmacist' &&
                ['verified', 'dispensed'].includes(rx.status));

        if (!allowed) {
            return res.status(403).json({
                message: 'You do not have access to this prescription image.'
            });
        }

        const file = path.join(
            uploads,
            path.basename(rx.imagePath || '')
        );

        if (!fs.existsSync(file)) {
            return res.status(404).json({
                message: 'Prescription image is unavailable.'
            });
        }

        res.setHeader('Cache-Control', 'private, no-store');
        res.sendFile(file);

    } catch {
        return res.status(400).json({
            message: 'Invalid prescription id.'
        });
    }
});

//AUTH: REGISTER

app.post('/api/auth/register', async (req, res) => {
    try {
        const {
            name,
            username,
            email,
            password,
            role = 'patient'
        } = req.body || {};

        if (!name || !username || !email || !password) {
            return res.status(400).json({
                message: 'Name, username, email and password are required.'
            });
        }

        if (!['patient', 'doctor', 'pharmacist'].includes(role)) {
            return res.status(400).json({
                message: 'Public registration is available for patients, doctors and pharmacists only.'
            });
        }

        if (String(name).trim().length < 2) {
            return res.status(400).json({
                message: 'Please enter your full name.'
            });
        }

        if (String(username).trim().length < 3) {
            return res.status(400).json({
                message: 'Username must be at least 3 characters.'
            });
        }

        if (String(password).length < 8) {
            return res.status(400).json({
                message: 'Password must be at least 8 characters.'
            });
        }

        const staff = role === 'doctor' || role === 'pharmacist';

        const user = await User.create({
            name: String(name).trim(),
            username: String(username).trim().toLowerCase(),
            email: String(email).trim().toLowerCase(),
            passwordHash: await bcrypt.hash(password, 12),
            role,
            isActive: !staff
        });

        await AuditLog.create({
            actor: user._id,
            action: 'self-registered',
            details: `${role}:${user.username}${staff ? ' (awaiting admin approval)' : ''}`
        });

        if (staff) {
            return res.status(201).json({
                pendingApproval: true,
                message: `Your ${role} registration was submitted. An administrator must approve your account before you can sign in.`
            });
        }

        const token = jwt.sign(
            {
                id: user._id,
                role: user.role,
                name: user.name
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.status(201).json({
            token,
            user: {
                id: user._id,
                name: user.name,
                username: user.username,
                role: user.role,
                email: user.email
            }
        });

    } catch (e) {
        res.status(400).json({
            message:
                e.code === 11000
                    ? 'That username or email is already registered. Please choose another.'
                    : 'Could not create account. Check your details and try again.'
        });
    }
});

//BOOTSTRAP ADMIN

app.post('/api/auth/bootstrap-admin', async (req, res) => {
    try {
        const configured = process.env.BOOTSTRAP_SECRET;

        if (!configured || configured.startsWith('replace_with_')) {
            return res.status(503).json({
                message: 'Set a strong BOOTSTRAP_SECRET in server/.env first.'
            });
        }

        if (req.get('x-bootstrap-secret') !== configured) {
            return res.status(403).json({
                message: 'Invalid setup secret.'
            });
        }

        if (await User.exists({ role: 'admin' })) {
            return res.status(409).json({
                message: 'An admin already exists. Ask an existing admin to create accounts.'
            });
        }

        const { name, username, email, password } = req.body || {};

        if (
            !name ||
            !username ||
            !email ||
            !password ||
            String(password).length < 12
        ) {
            return res.status(400).json({
                message: 'Name, username, email and a password of at least 12 characters are required.'
            });
        }

        const user = await User.create({
            name: String(name).trim(),
            username: String(username).trim().toLowerCase(),
            email: String(email).trim().toLowerCase(),
            passwordHash: await bcrypt.hash(password, 12),
            role: 'admin'
        });

        await AuditLog.create({
            actor: user._id,
            action: 'bootstrap-admin-created',
            details: 'Initial administrator account created'
        });

        res.status(201).json({
            message: 'Admin created. Remove/rotate BOOTSTRAP_SECRET in server/.env now.'
        });

    } catch (e) {
        res.status(400).json({
            message:
                e.code === 11000
                    ? 'Username or email already exists.'
                    : 'Could not create initial admin.'
        });
    }
});

//AUTH: LOGIN

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password, role } = req.body || {};

        if (!username || !password || !role) {
            return res.status(400).json({
                message: 'Username, password and role are required.'
            });
        }

        const user = await User.findOne({
            username: username.toLowerCase(),
            role
        });

        if (
            !user ||
            !(await bcrypt.compare(password, user.passwordHash))
        ) {
            return res.status(401).json({
                message: 'Invalid username, password or role.'
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                message: `Your ${user.role} account is awaiting administrator approval or has been deactivated.`
            });
        }

        const token = jwt.sign(
            {
                id: user._id,
                role: user.role,
                name: user.name
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                username: user.username,
                role: user.role,
                email: user.email
            }
        });

    } catch (e) {
        res.status(500).json({
            message: 'Unable to sign in.'
        });
    }
});

//AUTH: CURRENT USER

app.get('/api/auth/me', auth, async (req, res) => {
    const u = await User.findById(req.user.id).select('-passwordHash');

    if (!u) {
        return res.status(404).json({
            message: 'Account not found'
        });
    }

    res.json({
        user: {
            id: u._id,
            name: u.name,
            username: u.username,
            role: u.role,
            email: u.email
        }
    });
});

//DASHBOARD

app.get('/api/dashboard', auth, async (req, res) => {
    try {
        const role = req.user.role;
        let query = {};

        if (role === 'doctor') {
            query = { doctor: req.user.id };
        }

        if (role === 'patient') {
            query = { patient: req.user.id };
        }

        const [
            total,
            pending,
            verified,
            dispensed,
            recent
        ] = await Promise.all([
            Prescription.countDocuments(query),

            Prescription.countDocuments({
                ...query,
                status: 'pending_review'
            }),

            Prescription.countDocuments({
                ...query,
                status: 'verified'
            }),

            Prescription.countDocuments({
                ...query,
                status: 'dispensed'
            }),

            Prescription.find(query)
                .sort({ createdAt: -1 })
                .limit(6)
                .populate('doctor', 'name specialization')
                .populate('patient', 'name email')
        ]);

        let users = {};

        if (role === 'admin') {
            users.total = await User.countDocuments();
            users.doctors = await User.countDocuments({ role: 'doctor' });
            users.patients = await User.countDocuments({ role: 'patient' });
            users.pharmacists = await User.countDocuments({ role: 'pharmacist' });
        }

        res.json({
            counts: {
                total,
                pending,
                verified,
                dispensed,
                ...users
            },
            recent: recent.map(serialize)
        });

    } catch (e) {
        res.status(500).json({
            message: 'Could not load dashboard'
        });
    }
});

//USERS

app.get('/api/users', auth, allow('admin', 'doctor'), async (req, res) => {
    const role = req.user.role === 'doctor'
        ? 'patient'
        : req.query.role;

    const filter = role ? { role } : {};

    const users = await User.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .limit(200);

    res.json(users);
});

app.post('/api/users', auth, allow('admin'), async (req, res) => {
    try {
        const {
            name,
            username,
            email,
            password,
            role,
            specialization,
            phone,
            pharmacyName,
            age,
            gender
        } = req.body;

        if (!name || !username || !password || !role) {
            return res.status(400).json({
                message: 'Name, username, password and role are required.'
            });
        }

        if (!['doctor', 'patient', 'pharmacist', 'admin'].includes(role)) {
            return res.status(400).json({
                message: 'Invalid role.'
            });
        }

        const user = await User.create({
            name,
            username,
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role,
            specialization,
            phone,
            pharmacyName,
            age,
            gender
        });

        await AuditLog.create({
            actor: req.user.id,
            action: 'created user',
            details: `${role}:${username}`
        });

        res.status(201).json({
            id: user._id,
            name: user.name,
            username: user.username,
            role: user.role
        });

    } catch (e) {
        res.status(400).json({
            message:
                e.code === 11000
                    ? 'Username already exists.'
                    : 'Could not create user.'
        });
    }
});

app.patch('/api/users/:id/status', auth, allow('admin'), async (req, res) => {
    try {
        const u = await User.findById(req.params.id);

        if (!u) {
            return res.status(404).json({
                message: 'User not found'
            });
        }

        if (
            String(u._id) === req.user.id &&
            req.body.isActive === false
        ) {
            return res.status(400).json({
                message: 'You cannot deactivate your own administrator account.'
            });
        }

        u.isActive = req.body.isActive === true;

        await u.save();

        await AuditLog.create({
            actor: req.user.id,
            action: u.isActive ? 'activated account' : 'deactivated account',
            details: `${u.role}:${u.username}`
        });

        res.json({
            id: u._id,
            isActive: u.isActive
        });

    } catch {
        res.status(400).json({
            message: 'Invalid user id.'
        });
    }
});

//PRESCRIPTIONS

app.get('/api/prescriptions', auth, async (req, res) => {
    let filter = {};

    if (req.user.role === 'doctor') {
        filter.doctor = req.user.id;
    } else if (req.user.role === 'patient') {
        filter.patient = req.user.id;
    } else if (req.user.role === 'pharmacist') {
        filter.status = {
            $in: ['verified', 'dispensed']
        };
    }

    const rows = await Prescription.find(filter)
        .sort({ createdAt: -1 })
        .populate('doctor', 'name specialization')
        .populate('patient', 'name email')
        .limit(200);

    res.json(rows.map(serialize));
});

//UPLOAD PRESCRIPTION

app.post(
    '/api/prescriptions/upload',
    auth,
    allow('doctor'),

    (req, res, next) => {
        upload.single('image')(req, res, err => {
            if (err) {
                return res.status(
                    err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
                ).json({
                    message:
                        err.code === 'LIMIT_FILE_SIZE'
                            ? 'Image must be 10 MB or smaller.'
                            : err.message
                });
            }

            next();
        });
    },

    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    message: 'Choose a JPG or PNG prescription image.'
                });
            }

            const patient = await User.findOne({
                _id: req.body.patientId,
                role: 'patient'
            });

            if (!patient) {
                return res.status(400).json({
                    message: 'Select a valid patient account.'
                });
            }

            let rawText = '';
            let items = [];

            const rx = await Prescription.create({
                code: 'RX-' +
                    crypto.randomBytes(4).toString('hex').toUpperCase(),
                doctor: req.user.id,
                patient: patient._id,
                imagePath: `/uploads/${req.file.filename}`,
                rawText,
                items: [],
                status: 'pending_review'
            });

            await AuditLog.create({
                actor: req.user.id,
                action: 'uploaded prescription',
                details: rx.code
            });

            res.status(201).json(
                serialize(await rx.populate(['doctor', 'patient']))
            );

        } catch (e) {
            res.status(500).json({
                message: 'Upload failed. Please try again.'
            });
        }
    }
);

//AI RECOGNITION

app.post('/api/prescriptions/:id/recognize', auth, allow('doctor'), async (req, res) => {
    try {
        const rx = await Prescription.findOne({
            _id: req.params.id,
            doctor: req.user.id
        });

        if (!rx) {
            return res.status(404).json({
                message: 'Prescription not found'
            });
        }

        const file = path.join(
            uploads,
            path.basename(rx.imagePath || '')
        );

        const form = new FormData();

        form.append(
            'file',
            new Blob([fs.readFileSync(file)]),
            path.basename(file)
        );

        const response = await fetch(
            `${process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000'}/recognize`,
            {
                method: 'POST',
                body: form
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(502).json({
                message: data.detail || 'AI recognition failed'
            });
        }

        rx.rawText = data.raw_text || '';

        rx.items = (data.items || []).map(i => ({
            rawText: i.raw_text,
            drugName: i.drug_name,
            dosage: i.dosage,
            frequency: i.frequency,
            duration: i.duration,
            confidence: i.confidence
        }));

        await rx.save();

        res.json(serialize(rx));

    } catch (e) {
        res.status(502).json({
            message: 'AI service unavailable. Start the Python OCR service and retry.'
        });
    }
});

//EDIT PRESCRIPTION

app.patch('/api/prescriptions/:id', auth, allow('doctor'), async (req, res) => {
    const rx = await Prescription.findOne({
        _id: req.params.id,
        doctor: req.user.id
    });

    if (!rx) {
        return res.status(404).json({
            message: 'Prescription not found'
        });
    }

    if (rx.status !== 'pending_review') {
        return res.status(409).json({
            message: 'Only pending prescriptions can be edited.'
        });
    }

    if (!Array.isArray(req.body.items) || req.body.items.length > 50) {
        return res.status(400).json({
            message: 'Medicine items must be a list of up to 50 rows.'
        });
    }

    rx.items = req.body.items.map(i => ({
        rawText: String(i.rawText || '').slice(0, 1000),
        drugName: String(i.drugName || '').trim().slice(0, 200),
        dosage: String(i.dosage || '').trim().slice(0, 120),
        frequency: String(i.frequency || '').trim().slice(0, 120),
        duration: String(i.duration || '').trim().slice(0, 120),
        confidence: Math.max(
            0,
            Math.min(1, Number(i.confidence) || 0)
        )
    }));

    rx.finalText = rx.items
        .map(i => [
            i.drugName,
            i.dosage,
            i.frequency,
            i.duration
        ].filter(Boolean).join(' · '))
        .join('\n');

    await rx.save();

    await AuditLog.create({
        actor: req.user.id,
        action: 'edited prescription draft',
        details: rx.code
    });

    res.json(serialize(rx));
});

// ================= VERIFY PRESCRIPTION =================

app.post('/api/prescriptions/:id/verify', auth, allow('doctor'), async (req, res) => {
    const rx = await Prescription.findOne({
        _id: req.params.id,
        doctor: req.user.id
    });

    if (!rx) {
        return res.status(404).json({
            message: 'Prescription not found'
        });
    }

    if (
        !rx.items.length ||
        rx.items.some(i => !String(i.drugName || '').trim())
    ) {
        return res.status(400).json({
            message: 'Every medicine row must have a medicine name before verification.'
        });
    }

    rx.status = 'verified';
    rx.verifiedAt = new Date();

    await rx.save();

    await AuditLog.create({
        actor: req.user.id,
        action: 'verified prescription',
        details: rx.code
    });

    res.json(serialize(rx));
});

// SEARCH PRESCRIPTION BY CODE

app.get('/api/prescriptions/code/:code', auth, allow('doctor', 'pharmacist', 'admin'), async (req, res) => {
    const rx = await Prescription.findOne({
        code: req.params.code.toUpperCase()
    })
        .populate('doctor', 'name specialization')
        .populate('patient', 'name email');

    if (!rx) {
        return res.status(404).json({
            message: 'Prescription code not found'
        });
    }

    if (
        req.user.role === 'doctor' &&
        String(rx.doctor._id) !== req.user.id
    ) {
        return res.status(403).json({
            message: 'Not your prescription'
        });
    }

    if (
        req.user.role === 'pharmacist' &&
        !['verified', 'dispensed'].includes(rx.status)
    ) {
        return res.status(403).json({
            message: 'Only verified prescriptions are available to pharmacy accounts.'
        });
    }

    if (
        req.user.role === 'patient' &&
        String(rx.patient._id) !== req.user.id
    ) {
        return res.status(403).json({
            message: 'Not your prescription'
        });
    }

    res.json(serialize(rx));
});

// DISPENSE PRESCRIPTION

app.post('/api/prescriptions/:id/dispense', auth, allow('pharmacist'), async (req, res) => {
    try {
        const rx = await Prescription.findById(req.params.id);

        if (!rx) {
            return res.status(404).json({
                message: 'Prescription not found'
            });
        }

        if (rx.status !== 'verified') {
            return res.status(409).json({
                message: 'Only verified prescriptions can be dispensed.'
            });
        }

        rx.status = 'dispensed';
        rx.dispensedAt = new Date();

        await rx.save();

        await AuditLog.create({
            actor: req.user.id,
            action: 'dispensed prescription',
            details: rx.code
        });

        res.json(
            serialize(await rx.populate(['doctor', 'patient']))
        );

    } catch {
        res.status(400).json({
            message: 'Invalid prescription id.'
        });
    }
});

//AUDIT LOG

app.get('/api/audit', auth, allow('admin'), async (req, res) => {
    res.json(
        await AuditLog.find()
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('actor', 'name role')
    );
});

//SERIALIZE

function serialize(p) {
    return {
        id: p._id,
        code: p.code,
        status: p.status,
        doctor: p.doctor?.name || p.doctor,
        doctorId: p.doctor?._id || p.doctor,
        patient: p.patient?.name || p.patient,
        patientId: p.patient?._id || p.patient,
        patientEmail: p.patient?.email,
        createdAt: p.createdAt,
        verifiedAt: p.verifiedAt,
        dispensedAt: p.dispensedAt,
        imagePath: p.imagePath,
        rawText: p.rawText,
        finalText: p.finalText,
        items: p.items || []
    };
}

//DEMO SEED

async function seed() {
    if (process.env.SEED_DEMO !== 'true') return;

    if (await User.countDocuments()) return;

    const rows = [
        {
            name: 'Dr. Aanya Sharma',
            username: 'doctor1',
            password: 'doctor123',
            role: 'doctor',
            specialization: 'General Physician',
            email: 'doctor@example.com'
        },
        {
            name: 'Rohan Patient',
            username: 'patient1',
            password: 'patient123',
            role: 'patient',
            email: 'patient@example.com',
            age: 24,
            gender: 'Male'
        },
        {
            name: 'CarePlus Pharmacy',
            username: 'pharma1',
            password: 'pharma123',
            role: 'pharmacist',
            pharmacyName: 'CarePlus Pharmacy'
        },
        {
            name: 'System Administrator',
            username: 'admin',
            password: 'admin123',
            role: 'admin',
            email: 'admin@example.com'
        }
    ];

    for (const r of rows) {
        const { password, ...rest } = r;

        await User.create({
            ...rest,
            passwordHash: await bcrypt.hash(password, 12)
        });
    }

    console.log(
        'Demo accounts seeded (change these passwords before any real use).'
    );
}

//SERVER START

if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.startsWith('replace_with_') ||
    process.env.JWT_SECRET.length < 32
) {
    console.error(
        'Set a strong JWT_SECRET (32+ characters) in server/.env before starting.'
    );

    process.exit(1);
}

const port = process.env.PORT || 5000;

mongoose.connect(
    process.env.MONGO_URI ||
    'mongodb://127.0.0.1:27017/prescripto'
)
    .then(async () => {
        console.log('MongoDB connected');

        await seed();

        app.listen(port, '0.0.0.0', () => {
            console.log(`Prescripto API running on port ${port}`);
        });
    })
    .catch(e => {
        console.error('MongoDB connection failed:', e.message);
        process.exit(1);
    });

//404 HANDLER
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
});

// ERROR HANDLER

app.use((err, req, res, next) => {
    console.error(err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        message: 'Unexpected server error. Please try again.'
    });
});