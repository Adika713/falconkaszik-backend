require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());

// Environment variables
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'z2n5k9lu6ja19cq64d1n1pekwr8pcj';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '4uisld97aaj8rvuf268kbd2c4wugtz';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://falconkaszik-backend.onrender.com/auth/twitch/callback';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adika713:JedfwQ0wWkHdveNZ@kaszioldal.fuesawl.mongodb.net/?retryWrites=true&w=majority&appName=Kaszioldal';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://falconkaszik-frontend.vercel.app/';
const STREAMELEMENTS_JWT = process.env.STREAMELEMENTS_JWT || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjaXRhZGVsIiwiZXhwIjoxNzY1NzI1MDUxLCJqdGkiOiIwNjFjNzA3YS1lMTZkLTRkY2YtOTk3Zi0zM2Y3NTdkYTA1MjMiLCJjaGFubmVsIjoiNjY1OGJmZmMzMTM3NDk1ZDMzYjBhM2Y3Iiwicm9sZSI6Im93bmVyIiwiYXV0aFRva2VuIjoiTk5Ca2hHeUFodmN6am5mM2lzQy1lUXVKREZnb2o1eWZRYkQwNGpacnZoWTgteTdBIiwidXNlciI6IjY2NThiZmZjMzEzNzQ5NWQzM2IwYTNmNiIsInVzZXJfaWQiOiIzNmJmNTdmYi1hODVhLTQyYzYtYjdiNS03MjViODViM2IyOGIiLCJ1c2VyX3JvbGUiOiJjcmVhdG9yIiwicHJvdmlkZXIiOiJ0d2l0Y2giLCJwcm92aWRlcl9iZCI6IjEwNDYyNzI3MzgiLCJjaGFubmVsX2lkIjoiODE4NDYwZmYtYzc1YS00YWU2LTg4ZDQtZTlkZmE4OGVhODUxIiwiY3JlYXRvcl9pZCI6ImFkM2E0MDM5LTcwNjUtNDcxNC1iNDNlLTJmYmYzYzM0MDdlNiJ9.cyXqMN1aQinzpEEOHKE3wAeC5jWlwXyD2s1ybXh73g8';
const STREAMELEMENTS_CHANNEL_ID = process.env.STREAMELEMENTS_CHANNEL_ID || '6658bffc3137495d33b0a3f7';
const JWT_SECRET = process.env.JWT_SECRET || '3a85f866df8c9c084124b7eeb41b852a';

// Connect to MongoDB with retry
async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        setTimeout(connectMongoDB, 5000);
    }
}
connectMongoDB();

// User Schema
const UserSchema = new mongoose.Schema({
    twitch_id: { type: String, required: true, unique: true },
    display_name: String,
    login: String,
    profile_image_url: String,
    giveaways_attended: { type: Number, default: 0 },
    giveaways_won: { type: Number, default: 0 },
});

const User = mongoose.model('User', UserSchema);

// Giveaway Schema
const GiveawaySchema = new mongoose.Schema({
    pointsRequired: { type: Number, required: true },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    participants: [{ type: String }],
});

const Giveaway = mongoose.model('Giveaway', GiveawaySchema);

// OAuth Callback Route
app.get('/auth/twitch/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=no_code`);
    }

    try {
        const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI,
            },
        });

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': CLIENT_ID,
                'Authorization': `Bearer ${access_token}`,
            },
        });

        const twitchUser = userResponse.data.data[0];

        await User.updateOne(
            { twitch_id: twitchUser.id },
            {
                $set: {
                    display_name: twitchUser.display_name,
                    login: twitchUser.login.toLowerCase(),
                    profile_image_url: twitchUser.profile_image_url,
                },
            },
            { upsert: true }
        );

        const dbUser = await User.findOne({ twitch_id: twitchUser.id });

        const token = jwt.sign(
            { twitch_id: dbUser.twitch_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.setHeader('Set-Cookie', `jwt_token=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=86400`);
        const userData = {
            id: dbUser.twitch_id,
            display_name: dbUser.display_name,
            login: dbUser.login,
            profile_image_url: dbUser.profile_image_url,
            giveaways_attended: dbUser.giveaways_attended,
            giveaways_won: dbUser.giveaways_won,
        };

        const userDataQuery = encodeURIComponent(JSON.stringify(userData));
        res.redirect(`${FRONTEND_URL}?user=${userDataQuery}`);
    } catch (error) {
        console.error('Error during Twitch OAuth:', error.message);
        res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    }
});

// Token Verification Route
app.post('/auth/verify-token', async (req, res) => {
    const { jwt_token } = req.body;

    if (!jwt_token) {
        return res.status(400).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user.twitch_id,
            display_name: user.display_name,
            login: user.login,
            profile_image_url: user.profile_image_url,
            giveaways_attended: user.giveaways_attended,
            giveaways_won: user.giveaways_won,
        });
    } catch (error) {
        console.error('Error verifying token:', error.message);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});

// Fetch User Points
app.get('/api/points/:username', async (req, res) => {
    const { username } = req.params;

    try {
        const response = await axios.get(`https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${username.toLowerCase()}`, {
            headers: {
                'Authorization': `Bearer ${STREAMELEMENTS_JWT}`
            }
        });
        res.json({ points: response.data.points });
    } catch (error) {
        console.error('Error fetching points:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.status(500).json({ error: 'Failed to fetch points', details: error.message });
    }
});

// Deduct Points
app.post('/api/points/deduct', async (req, res) => {
    const { username, amount } = req.body;

    if (!username || !amount || amount >= 0) {
        return res.status(400).json({ error: 'Invalid username or amount' });
    }

    try {
        const response = await axios.put(
            `https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${username.toLowerCase()}/${amount}`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${STREAMELEMENTS_JWT}`
                }
            }
        );
        res.json({ points: response.data.points });
    } catch (error) {
        console.error('Error deducting points:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.status(500).json({ error: 'Failed to deduct points', details: error.message });
    }
});

// Create Giveaway
app.post('/api/giveaway/create', async (req, res) => {
    const { pointsRequired, jwt_token } = req.body;

    if (!pointsRequired || pointsRequired < 1) {
        return res.status(400).json({ error: 'Invalid points required' });
    }

    if (!jwt_token) {
        return res.status(400).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user || user.login !== 'airfalconx') {
            return res.status(403).json({ error: 'Unauthorized: Only airfalconx can create giveaways' });
        }

        await Giveaway.updateMany({ active: true }, { $set: { active: false } });

        const giveaway = await Giveaway.create({ pointsRequired });
        res.json({ message: 'Giveaway created successfully', giveaway });
    } catch (error) {
        console.error('Error creating giveaway:', error.message);
        res.status(500).json({ error: 'Failed to create giveaway' });
    }
});

// Get Giveaway Status
app.get('/api/giveaway/get', async (req, res) => {
    try {
        const giveaway = await Giveaway.findOne({ active: true });
        if (!giveaway) {
            return res.json({ active: false });
        }
        res.json({
            active: true,
            pointsRequired: giveaway.pointsRequired,
            participants: giveaway.participants
        });
    } catch (error) {
        console.error('Error fetching giveaway:', error.message);
        res.status(500).json({ error: 'Failed to fetch giveaway' });
    }
});

// Enter Giveaway
app.post('/api/giveaway/enter', async (req, res) => {
    const { username, jwt_token } = req.body;

    if (!username || !jwt_token) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user || user.login !== username.toLowerCase()) {
            return res.status(403).json({ error: 'Unauthorized user' });
        }

        const giveaway = await Giveaway.findOne({ active: true });
        if (!giveaway) {
            return res.status(404).json({ error: 'No active giveaway' });
        }

        if (giveaway.participants.includes(username.toLowerCase())) {
            return res.status(400).json({ error: 'Already entered this giveaway' });
        }

        const pointsResponse = await axios.get(`https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${username.toLowerCase()}`, {
            headers: {
                'Authorization': `Bearer ${STREAMELEMENTS_JWT}`
            }
        });
        const currentPoints = pointsResponse.data.points;

        if (currentPoints < giveaway.pointsRequired) {
            return res.status(400).json({ error: 'Insufficient points' });
        }

        const deductResponse = await axios.put(
            `https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${username.toLowerCase()}/${-giveaway.pointsRequired}`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${STREAMELEMENTS_JWT}`
                }
            }
        );

        await Giveaway.updateOne(
            { _id: giveaway._id },
            { $push: { participants: username.toLowerCase() } }
        );

        res.json({ message: 'Entered giveaway successfully', points: deductResponse.data.points });
    } catch (error) {
        console.error('Error entering giveaway:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.status(500).json({ error: error.message || 'Failed to enter giveaway' });
    }
});

// Update Giveaway Attendance
app.post('/api/giveaway/attend', async (req, res) => {
    const { twitch_id, jwt_token } = req.body;

    if (!twitch_id || !jwt_token) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        if (decoded.twitch_id !== twitch_id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findOne({ twitch_id });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.updateOne(
            { twitch_id },
            { $inc: { giveaways_attended: 1 } }
        );

        const updatedUser = await User.findOne({ twitch_id });
        res.json({
            id: updatedUser.twitch_id,
            giveaways_attended: updatedUser.giveaways_attended,
            giveaways_won: updatedUser.giveaways_won,
        });
    } catch (error) {
        console.error('Error updating giveaway attendance:', error.message);
        res.status(500).json({ error: 'Failed to update giveaway data' });
    }
});

// Update Giveaway Wins
app.post('/api/giveaway/win', async (req, res) => {
    const { twitch_id, jwt_token } = req.body;

    if (!twitch_id || !jwt_token) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        if (decoded.twitch_id !== twitch_id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findOne({ twitch_id });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.updateOne(
            { twitch_id },
            { $inc: { giveaways_won: 1 } }
        );

        const updatedUser = await User.findOne({ twitch_id });
        res.json({
            id: updatedUser.twitch_id,
            giveaways_attended: updatedUser.giveaways_attended,
            giveaways_won: updatedUser.giveaways_won,
        });
    } catch (error) {
        console.error('Error updating giveaway win:', error.message);
        res.status(500).json({ error: 'Failed to update giveaway data' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));