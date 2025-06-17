require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors({ 
    origin: process.env.FRONTEND_URL, 
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());

// Environment variables
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'z2n5k9lu6ja19cq64d1n1pekwr8pcj';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '4uisld97aaj8rvuf268kbd2c4wugtz';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://falconkaszik-backend.onrender.com/auth/twitch/callback';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adika713:JedfwQ0wWkHdveNZ@kaszioldal.fuesawl.mongodb.net/?retryWrites=true&w=majority&appName=Kaszioldal';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://falconkaszik-frontend.vercel.app';
const STREAMELEMENTS_JWT = process.env.STREAMELEMENTS_JWT || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjaXRhZGVsIiwiZXhwIjoxNzY1NzI1MDUxLCJqdGkiOiIwNjFjNzA3YS1lMTZkLTRkY2YtOTk3Zi0zM2Y3NTdkYTA1MjMiLCJjaGFubmVsIjoiNjY1OGJmZmMzMTM3NDk1ZDMzYjBhM2Y3Iiwicm9sZSI6Im93bmVyIiwiYXV0aFRva2VuIjoiTk5Ca2hHeUFodmN6am5mM2lzQy1lUXVKREZnb2o1eWZRYkQwNGpacnZoWTgteTdBIiwidXNlciI6IjY2NThiZmZjMzEzNzQ5NWQzM2IwYTNmNiIsInVzZXJfaWQiOiIzNmJmNTdmYi1hODVhLTQyYzYtYjdiNS03MjViODViM2IyOGIiLCJ1c2VyX3JvbGUiOiJjcmVhdG9yIiwicHJvdmlkZXIiOiJ0d2l0Y2giLCJwcm92aWRlcl9pZCI6IjEwNDYyNzI3MzgiLCJjaGFubmVsX2lkIjoiODE4NDYwZmYtYzc1YS00YWU2LTg4ZDQtZTlkZmE4OGVhODUxIiwiY3JlYXRvcl9pZCI6ImFkM2E0MDM5LTcwNjUtNDcxNC1iNDNlLTJmYmYzYzM0MDdlNiJ9.cyXqMN1aQinzpEEOHKE3wAeC5jWlwXyD2s1ybXh73g8';
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
    console.log('OAuth callback:', { code: !!code, state });

    if (!code) {
        console.error('No code provided');
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
        console.log('Twitch token response:', { access_token: !!tokenResponse.data.access_token });

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': CLIENT_ID,
                'Authorization': `Bearer ${access_token}`,
            },
        });
        console.log('Twitch user response:', { user: userResponse.data.data[0]?.login });

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
        console.log('User saved:', { twitch_id: dbUser.twitch_id, login: dbUser.login });

        const token = jwt.sign(
            { twitch_id: dbUser.twitch_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        console.log('JWT generated for:', dbUser.login);

        res.setHeader('Set-Cookie', `jwt_token=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`);
        console.log('Cookie set: jwt_token');

        const userData = {
            id: dbUser.twitch_id,
            display_name: dbUser.display_name,
            login: dbUser.login,
            profile_image_url: dbUser.profile_image_url,
            giveaways_attended: dbUser.giveaways_attended,
            giveaways_won: dbUser.giveaways_won,
        };

        const userDataQuery = encodeURIComponent(JSON.stringify(userData));
        console.log('Redirecting to frontend with user data');
        res.redirect(`${FRONTEND_URL}?user=${userDataQuery}`);
    } catch (error) {
        console.error('OAuth error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    }
});

// Token Verification Route
app.post('/auth/verify-token', async (req, res) => {
    const { jwt_token } = req.body;
    console.log('Verify token:', { token_provided: !!jwt_token });

    if (!jwt_token) {
        console.error('No token provided');
        return res.status(400).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        console.log('Token decoded:', { twitch_id: decoded.twitch_id });

        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user) {
            console.error('User not found:', decoded.twitch_id);
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
        console.error('Token verification error:', {
            message: error.message,
            name: error.name
        });
        res.status(401).json({ error: 'Invalid or expired token', details: error.message });
    }
});

// Fetch User Points
app.get('/api/points/:username', async (req, res) => {
    const { username } = req.params;
    const lowerUsername = username.toLowerCase();
    console.log('Fetching points:', { username: lowerUsername });

    try {
        const response = await axios.get(`https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${lowerUsername}`, {
            headers: {
                'Authorization': `Bearer ${STREAMELEMENTS_JWT}`,
                'Accept': 'application/json'
            },
            timeout: 5000
        });
        console.log('StreamElements response:', {
            username: lowerUsername,
            points: response.data.points,
            status: response.status
        });
        res.json({ points: response.data.points });
    } catch (error) {
        console.error('Points fetch error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
            url: `https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${lowerUsername}`
        });
        res.status(500).json({ error: 'Failed to fetch points', details: error.message, status: error.response?.status });
    }
});

// Deduct Points
app.post('/api/points/deduct', async (req, res) => {
    const { username, amount } = req.body;
    const lowerUsername = username.toLowerCase();
    console.log('Deducting points:', { username: lowerUsername, amount });

    if (!username || !amount || amount >= 0) {
        console.error('Invalid deduct request');
        return res.status(400).json({ error: 'Invalid username or amount' });
    }

    try {
        const response = await axios.put(
            `https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${lowerUsername}/${amount}`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${STREAMELEMENTS_JWT}`,
                    'Accept': 'application/json'
                },
                timeout: 5000
            }
        );
        console.log('Points deducted:', { username: lowerUsername, points: response.data.points });
        res.json({ points: response.data.points });
    } catch (error) {
        console.error('Points deduct error:', {
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
    console.log('Creating giveaway:', { pointsRequired });

    if (!pointsRequired || pointsRequired < 1) {
        console.error('Invalid points required');
        return res.status(400).json({ error: 'Invalid points required' });
    }

    if (!jwt_token) {
        console.error('No token provided');
        return res.status(400).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user || user.login !== 'airfalconx') {
            console.error('Unauthorized giveaway creation');
            return res.status(403).json({ error: 'Unauthorized: Only airfalconx can create giveaways' });
        }

        await Giveaway.updateMany({ active: true }, { $set: { active: false } });

        const giveaway = await Giveaway.create({ pointsRequired });
        console.log('Giveaway created:', { id: giveaway._id });
        res.json({ message: 'Giveaway created successfully', giveaway });
    } catch (error) {
        console.error('Giveaway creation error:', error.message);
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
        console.error('Giveaway fetch error:', error.message);
        res.status(500).json({ error: 'Failed to fetch giveaway' });
    }
});

// Enter Giveaway
app.post('/api/giveaway/enter', async (req, res) => {
    const { username, jwt_token } = req.body;
    const lowerUsername = username.toLowerCase();
    console.log('Entering giveaway:', { username: lowerUsername });

    if (!username || !jwt_token) {
        console.error('Invalid giveaway entry');
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        const user = await User.findOne({ twitch_id: decoded.twitch_id });
        if (!user || user.login !== lowerUsername) {
            console.error('Unauthorized giveaway entry');
            return res.status(403).json({ error: 'Unauthorized user' });
        }

        const giveaway = await Giveaway.findOne({ active: true });
        if (!giveaway) {
            console.error('No active giveaway');
            return res.status(404).json({ error: 'No active giveaway' });
        }

        if (giveaway.participants.includes(lowerUsername)) {
            console.error('Already entered');
            return res.status(400).json({ error: 'Already entered this giveaway' });
        }

        const pointsResponse = await axios.get(`https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${lowerUsername}`, {
            headers: {
                'Authorization': `Bearer ${STREAMELEMENTS_JWT}`,
                'Accept': 'application/json'
            },
            timeout: 5000
        });
        const currentPoints = pointsResponse.data.points;
        console.log('Current points:', { username: lowerUsername, points: currentPoints });

        if (currentPoints < giveaway.pointsRequired) {
            console.error('Insufficient points');
            return res.status(400).json({ error: 'Insufficient points' });
        }

        const deductResponse = await axios.put(
            `https://api.streamelements.com/kappa/v2/points/${STREAMELEMENTS_CHANNEL_ID}/${lowerUsername}/${-giveaway.pointsRequired}`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${STREAMELEMENTS_JWT}`,
                    'Accept': 'application/json'
                },
                timeout: 5000
            }
        );
        console.log('Points deducted:', { username: lowerUsername, points: deductResponse.data.points });

        await Giveaway.updateOne(
            { _id: giveaway._id },
            { $push: { participants: lowerUsername } }
        );

        res.json({ message: 'Entered giveaway successfully', points: deductResponse.data.points });
    } catch (error) {
        console.error('Giveaway entry error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.status(500).json({ error: 'Failed to enter giveaway', details: error.message });
    }
});

// Update Giveaway Attendance
app.post('/api/giveaway/attend', async (req, res) => {
    const { twitch_id, jwt_token } = req.body;
    console.log('Updating attendance:', { twitch_id });

    if (!twitch_id || !jwt_token) {
        console.error('Invalid attendance request');
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        if (decoded.twitch_id !== twitch_id) {
            console.error('Unauthorized attendance update');
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findOne({ twitch_id });
        if (!user) {
            console.error('User not found');
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
        console.error('Attendance update error:', error.message);
        res.status(500).json({ error: 'Failed to update giveaway data' });
    }
});

// Update Giveaway Wins
app.post('/api/giveaway/win', async (req, res) => {
    const { twitch_id, jwt_token } = req.body;
    console.log('Updating win:', { twitch_id });

    if (!twitch_id || !jwt_token) {
        console.error('Invalid win request');
        return res.status(400).json({ error: 'Invalid request' });
    }

    try {
        const decoded = jwt.verify(jwt_token, JWT_SECRET);
        if (decoded.twitch_id !== twitch_id) {
            console.error('Unauthorized win update');
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const user = await User.findOne({ twitch_id });
        if (!user) {
            console.error('User not found');
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
        console.error('Win update error:', error.message);
        res.status(500).json({ error: 'Failed to update giveaway data' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));